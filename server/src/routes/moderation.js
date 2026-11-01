const router = require('express').Router();
const { z } = require('zod');
const { pool, tx, audit } = require('../db');
const { requireAuth, requireRole } = require('../auth');

router.use(requireAuth, requireRole('moderator'));

// Moderators see the subject's verified identity so they can compare it to the record.
// Reporter identities are NOT included.
router.get('/cases', async (req, res) => {
  const status = z.enum(['open', 'recheck', 'suspended', 'cleared', 'all']).default('open').parse(req.query.status);
  const { rows } = await pool.query(
    `SELECT c.id, c.source, c.severity, c.status, c.details, c.created_at, c.decided_at, c.decision_note,
            u.id AS subject_id, u.legal_name, u.date_of_birth, u.status AS account_status,
            p.display_name
       FROM review_cases c
       JOIN users u ON u.id = c.subject_id
       LEFT JOIN profiles p ON p.user_id = u.id
      WHERE ($1 = 'all' OR c.status::text = $1 OR ($1 = 'open' AND c.status = 'recheck'))
      ORDER BY (c.severity = 'high') DESC, c.created_at
      LIMIT 100`,
    [status]
  );
  res.json(rows);
});

const Decision = z.object({
  decision: z.enum(['suspend', 'clear', 'recheck']),
  note: z.string().trim().min(3, 'Add a short note explaining the decision').max(1000),
});

router.post('/cases/:id/decision', async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const { decision, note } = Decision.parse(req.body);
  const newStatus = { suspend: 'suspended', clear: 'cleared', recheck: 'recheck' }[decision];

  const result = await tx(async db => {
    const { rows: [c] } = await db.query('SELECT * FROM review_cases WHERE id = $1 FOR UPDATE', [id]);
    if (!c) return { code: 404, body: { error: 'Case not found.' } };
    if (!['open', 'recheck'].includes(c.status)) return { code: 409, body: { error: 'Case already decided.' } };

    await db.query(
      `UPDATE review_cases SET status = $2::case_status, decided_by = $3, decision_note = $4,
              decided_at = CASE WHEN $2::text IN ('suspended', 'cleared') THEN now() END
        WHERE id = $1`,
      [id, newStatus, req.user.id, note]
    );

    if (decision === 'suspend') {
      await db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [c.subject_id]);
      await db.query('UPDATE matches SET active = false WHERE $1 IN (user_a, user_b)', [c.subject_id]);
      // Close any other open cases on the same person.
      await db.query(
        `UPDATE review_cases SET status = 'suspended', decided_by = $2, decision_note = 'Closed with case ' || $3, decided_at = now()
          WHERE subject_id = $1 AND id <> $3 AND status IN ('open', 'recheck')`,
        [c.subject_id, req.user.id, id]
      );
    } else if (decision === 'clear') {
      // Reactivate only when no other case on this person is still open.
      const { rows: others } = await db.query(
        `SELECT 1 FROM review_cases WHERE subject_id = $1 AND id <> $2 AND status IN ('open', 'recheck')`, [c.subject_id, id]
      );
      if (!others.length)
        await db.query(`UPDATE users SET status = 'active' WHERE id = $1 AND status = 'under_review'`, [c.subject_id]);
    }

    await audit(db, req.user.id, 'case.decide', id, { decision, subject: c.subject_id });
    return { code: 200, body: { id, status: newStatus } };
  });
  res.status(result.code).json(result.body);
});

router.get('/audit', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, actor_id, action, target_id, meta, created_at FROM audit_log ORDER BY id DESC LIMIT 200'
  );
  res.json(rows);
});

module.exports = router;
