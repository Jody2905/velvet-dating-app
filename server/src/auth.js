const jwt = require('jsonwebtoken');
const { pool } = require('./db');

const SECRET = () => {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error('JWT_SECRET must be set and at least 32 characters');
  return s;
};

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, SECRET(), { expiresIn: '12h' });
}

// Verifies the token and reloads the user so suspensions take effect immediately.
async function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in required' });
  try {
    const { sub } = jwt.verify(token, SECRET());
    const { rows } = await pool.query('SELECT id, role, status FROM users WHERE id = $1', [sub]);
    if (!rows[0]) return res.status(401).json({ error: 'Account not found' });
    if (rows[0].status === 'suspended') return res.status(403).json({ error: 'This account is suspended' });
    req.user = rows[0];
    next();
  } catch {
    res.status(401).json({ error: 'Session expired or invalid. Sign in again.' });
  }
}

function requireRole(role) {
  return (req, res, next) =>
    req.user.role === role ? next() : res.status(403).json({ error: 'Not allowed' });
}

// Only cleared members can browse, like and message.
function requireActive(req, res, next) {
  if (req.user.role === 'moderator' || req.user.status === 'active') return next();
  res.status(403).json({ error: 'Finish verification and screening first', status: req.user.status });
}

module.exports = { signToken, requireAuth, requireRole, requireActive };
