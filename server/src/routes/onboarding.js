const router = require('express').Router();
const { z } = require('zod');
const { pool, tx, audit } = require('../db');
const { requireAuth } = require('../auth');
const { screen } = require('../services/screening');

router.use(requireAuth);

const ProfileBody = z.object({
  displayName: z.string().trim().min(1).max(40),
  location: z.string().trim().max(80).optional(),
  bio: z.string().trim().max(500).optional(),
  interests: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
});

router.put('/profile', async (req, res) => {
  const p = ProfileBody.parse(req.body);
  const { rows } = await pool.query(
    `INSERT INTO profiles (user_id, display_name, location, bio, interests)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET display_name = $2, location = $3, bio = $4, interests = $5, updated_at = now()
     RETURNING display_name, location, bio, interests`,
    [req.user.id, p.displayName, p.location || null, p.bio || null, p.interests || []]
  );
  res.json(rows[0]);
});

// Called after the ID-verification provider finishes (in production this would be the
// provider's signed webhook, not a client call). Images never touch this server.
const VerificationBody = z.object({
  providerRef: z.string().min(1).max(200),
  idDocument: z.enum(['passed', 'failed']),
  selfieLiveness: z.enum(['passed', 'failed']),
});

router.post('/verification', async (req, res) => {
  const v = VerificationBody.parse(req.body);
  await tx(async db => {
    await db.query(
      `UPDATE verifications SET id_document = $2::verification_status, selfie_liveness = $3::verification_status, provider = 'mock', provider_ref = $4,
              verified_at = CASE WHEN $2::text = 'passed' AND $3::text = 'passed' THEN now() END
        WHERE user_id = $1`,
      [req.user.id, v.idDocument, v.selfieLiveness, v.providerRef]
    );
    await audit(db, req.user.id, 'verification.result', req.user.id, { idDocument: v.idDocument, selfie: v.selfieLiveness });
  });
  const passed = v.idDocument === 'passed' && v.selfieLiveness === 'passed';
  res.json({ passed, next: passed ? 'screening' : 'retry_verification' });
});

const ScreeningBody = z.object({
  consent: z.literal(true, { error: 'Consent is required to run screening' }),
  scenario: z.enum(['clear', 'registry', 'watchlist']).optional(), // demo only
});

router.post('/screening', async (req, res) => {
  const body = ScreeningBody.parse(req.body);
  const scenario = process.env.DEMO_MODE === 'true' ? body.scenario : undefined;

  const { rows: [me] } = await pool.query(
    `SELECT u.id, u.legal_name, u.date_of_birth, u.status, v.id_document, v.selfie_liveness
       FROM users u JOIN verifications v ON v.user_id = u.id WHERE u.id = $1`,
    [req.user.id]
  );
  if (me.id_document !== 'passed' || me.selfie_liveness !== 'passed')
    return res.status(409).json({ error: 'Verify your ID and selfie before screening.' });
  if (me.status !== 'pending')
    return res.status(409).json({ error: 'Screening already completed.', status: me.status });

  const result = await screen(me, { scenario });

  const outcome = await tx(async db => {
    const outcome = result.hits.length ? 'possible_match' : 'clear';
    await db.query(
      `INSERT INTO screening_results (user_id, consent_at, provider, outcome, hits) VALUES ($1, now(), $2, $3, $4)`,
      [me.id, result.provider, outcome, JSON.stringify(result.hits)]
    );
    if (outcome === 'clear') {
      await db.query(`UPDATE users SET status = 'active' WHERE id = $1`, [me.id]);
    } else {
      await db.query(`UPDATE users SET status = 'under_review' WHERE id = $1`, [me.id]);
      for (const hit of result.hits) {
        const { rows } = await db.query(
          `INSERT INTO review_cases (subject_id, source, severity, details) VALUES ($1, $2, $3, $4) RETURNING id`,
          [me.id, 'screening:' + hit.list, hit.severity, JSON.stringify({ comparison: hit.comparison })]
        );
        await audit(db, null, 'case.open', rows[0].id, { subject: me.id, source: hit.list, severity: hit.severity });
      }
    }
    await audit(db, me.id, 'screening.complete', me.id, { outcome });
    return outcome;
  });

  // The member only learns whether review is needed, never what was found.
  res.json(outcome === 'clear'
    ? { status: 'active', message: "You're verified." }
    : { status: 'under_review', message: 'Your account needs a quick manual review before it goes live.' });
});

module.exports = router;
