const router = require('express').Router();
const { z } = require('zod');
const { pool, tx, audit } = require('../db');
const { requireAuth, requireActive } = require('../auth');
const { checkMessage } = require('../services/messageSafety');

router.use(requireAuth, requireActive);

const Uuid = z.string().uuid();

// Public fields only. Legal name and DOB never leave the server; age is computed.
router.get('/discover', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, p.display_name, p.location, p.bio, p.interests,
            date_part('year', age(u.date_of_birth))::int AS age,
            true AS verified
       FROM users u
       JOIN profiles p ON p.user_id = u.id
      WHERE u.status = 'active' AND u.role = 'member' AND u.id <> $1
        AND NOT EXISTS (SELECT 1 FROM likes l WHERE l.liker_id = $1 AND l.liked_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
                                              OR (b.blocker_id = u.id AND b.blocked_id = $1))
      ORDER BY p.updated_at DESC
      LIMIT 20`,
    [req.user.id]
  );
  res.json(rows);
});

router.post('/likes/:userId', async (req, res) => {
  const target = Uuid.parse(req.params.userId);
  if (target === req.user.id) return res.status(400).json({ error: "You can't like yourself." });

  const result = await tx(async db => {
    const { rows: [t] } = await db.query(
      `SELECT id FROM users u WHERE id = $1 AND status = 'active' AND role = 'member'
         AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $2 AND b.blocked_id = u.id)
                                               OR (b.blocker_id = u.id AND b.blocked_id = $2))`,
      [target, req.user.id]
    );
    if (!t) return null;
    await db.query('INSERT INTO likes (liker_id, liked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, target]);
    const { rows: mutual } = await db.query('SELECT 1 FROM likes WHERE liker_id = $1 AND liked_id = $2', [target, req.user.id]);
    if (!mutual.length) return { matched: false };
    const [a, b] = [req.user.id, target].sort();
    const { rows: [m] } = await db.query(
      `INSERT INTO matches (user_a, user_b) VALUES ($1, $2)
       ON CONFLICT (user_a, user_b) DO UPDATE SET user_a = EXCLUDED.user_a RETURNING id`,
      [a, b]
    );
    await audit(db, req.user.id, 'match.create', m.id);
    return { matched: true, matchId: m.id };
  });
  if (!result) return res.status(404).json({ error: 'That member is not available.' });
  res.status(201).json(result);
});

router.get('/matches', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT m.id, m.created_at, p.user_id, p.display_name, p.location
       FROM matches m
       JOIN profiles p ON p.user_id = CASE WHEN m.user_a = $1 THEN m.user_b ELSE m.user_a END
      WHERE m.active AND $1 IN (m.user_a, m.user_b)
      ORDER BY m.created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
});

async function loadMatch(matchId, userId) {
  const { rows } = await pool.query(
    'SELECT id FROM matches WHERE id = $1 AND active AND $2 IN (user_a, user_b)', [matchId, userId]
  );
  return rows[0];
}

router.get('/matches/:id/messages', async (req, res) => {
  const id = Uuid.parse(req.params.id);
  if (!(await loadMatch(id, req.user.id))) return res.status(404).json({ error: 'Match not found.' });
  const { rows } = await pool.query(
    'SELECT id, sender_id, body, safety_flag, created_at FROM messages WHERE match_id = $1 ORDER BY created_at, id LIMIT 200', [id]
  );
  res.json(rows);
});

const MessageBody = z.object({ body: z.string().trim().min(1).max(2000) });

router.post('/matches/:id/messages', async (req, res) => {
  const id = Uuid.parse(req.params.id);
  const { body } = MessageBody.parse(req.body);
  if (!(await loadMatch(id, req.user.id))) return res.status(404).json({ error: 'Match not found.' });
  const flag = checkMessage(body);
  const { rows: [msg] } = await pool.query(
    `INSERT INTO messages (match_id, sender_id, body, safety_flag) VALUES ($1, $2, $3, $4)
     RETURNING id, sender_id, body, safety_flag, created_at`,
    [id, req.user.id, body, flag]
  );
  res.status(201).json({
    ...msg,
    warning: flag ? 'Sharing contact details or talking about money early is a common scam pattern. Take your time.' : null,
  });
});

async function blockAndUnmatch(db, me, other) {
  await db.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [me, other]);
  const [a, b] = [me, other].sort();
  await db.query('UPDATE matches SET active = false WHERE user_a = $1 AND user_b = $2', [a, b]);
}

router.post('/blocks/:userId', async (req, res) => {
  const other = Uuid.parse(req.params.userId);
  await tx(async db => {
    await blockAndUnmatch(db, req.user.id, other);
    await audit(db, req.user.id, 'user.block', other);
  });
  res.status(204).end();
});

const REASONS = ['unsafe', 'money_request', 'fake_profile', 'underage', 'other'];
const ReportBody = z.object({ reason: z.enum(REASONS), details: z.string().trim().max(1000).optional() });

// Reporting always blocks too. Serious reasons hide the reported account until reviewed.
router.post('/reports/:userId', async (req, res) => {
  const other = Uuid.parse(req.params.userId);
  if (other === req.user.id) return res.status(400).json({ error: "You can't report yourself." });
  const { reason, details } = ReportBody.parse(req.body);
  const severity = ['unsafe', 'underage'].includes(reason) ? 'high' : 'medium';

  const caseId = await tx(async db => {
    const { rows: [u] } = await db.query('SELECT id FROM users WHERE id = $1', [other]);
    if (!u) return null;
    await blockAndUnmatch(db, req.user.id, other);
    const { rows: [c] } = await db.query(
      `INSERT INTO review_cases (subject_id, source, severity, details) VALUES ($1, $2, $3, $4) RETURNING id`,
      [other, 'report:' + reason, severity, JSON.stringify({ details: details || null })]
    );
    await db.query('INSERT INTO reports (reporter_id, reported_id, reason, details, case_id) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, other, reason, details || null, c.id]);
    if (severity === 'high')
      await db.query(`UPDATE users SET status = 'under_review' WHERE id = $1 AND status = 'active'`, [other]);
    await audit(db, req.user.id, 'report.create', c.id, { reason, severity });
    return c.id;
  });
  if (!caseId) return res.status(404).json({ error: 'Member not found.' });
  res.status(201).json({ message: "Thanks. We've blocked them for you and a moderator will review the report." });
});

module.exports = router;
