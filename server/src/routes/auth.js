const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { pool, tx, audit } = require('../db');
const { signToken, requireAuth } = require('../auth');

const ageOn = (dob, today = new Date()) => {
  const b = new Date(dob + 'T00:00:00Z');
  let age = today.getUTCFullYear() - b.getUTCFullYear();
  const m = today.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < b.getUTCDate())) age--;
  return age;
};

const RegisterBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10, 'Password must be at least 10 characters').max(128),
  legalName: z.string().trim().min(2).max(120),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
});

router.post('/register', async (req, res) => {
  const body = RegisterBody.parse(req.body);
  if (ageOn(body.dateOfBirth) < 18) return res.status(400).json({ error: 'You must be 18 or older to join Velvet.' });

  const hash = await bcrypt.hash(body.password, 12);
  try {
    const user = await tx(async db => {
      const { rows } = await db.query(
        `INSERT INTO users (email, password_hash, legal_name, date_of_birth)
         VALUES ($1, $2, $3, $4) RETURNING id, role, status`,
        [body.email, hash, body.legalName, body.dateOfBirth]
      );
      await db.query('INSERT INTO verifications (user_id) VALUES ($1)', [rows[0].id]);
      await audit(db, rows[0].id, 'user.register', rows[0].id);
      return rows[0];
    });
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An account with that email already exists.' });
    throw err;
  }
});

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

router.post('/login', async (req, res) => {
  const { email, password } = LoginBody.parse(req.body);
  const { rows } = await pool.query('SELECT id, role, status, password_hash FROM users WHERE email = $1', [email]);
  // Same error and similar timing whether the email exists or not.
  const ok = await bcrypt.compare(password, rows[0]?.password_hash || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
  if (!rows[0] || !ok) return res.status(401).json({ error: 'Email or password is incorrect.' });
  if (rows[0].status === 'suspended') return res.status(403).json({ error: 'This account is suspended' });
  const { password_hash, ...user } = rows[0];
  await audit(pool, user.id, 'user.login', user.id);
  res.json({ token: signToken(user), user });
});

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.legal_name, u.date_of_birth, u.role, u.status,
            v.id_document, v.selfie_liveness,
            p.display_name, p.location, p.bio, p.interests
       FROM users u
       LEFT JOIN verifications v ON v.user_id = u.id
       LEFT JOIN profiles p ON p.user_id = u.id
      WHERE u.id = $1`,
    [req.user.id]
  );
  res.json(rows[0]);
});

module.exports = router;
module.exports.ageOn = ageOn;
