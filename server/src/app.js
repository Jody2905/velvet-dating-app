const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const { ZodError } = require('zod');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: (process.env.CORS_ORIGIN || 'http://localhost:5500').split(',') }));
  app.use(express.json({ limit: '20kb' }));

  const limiter = (limit, windowMs) =>
    process.env.NODE_ENV === 'test'
      ? (req, res, next) => next()
      : rateLimit({ windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false,
          message: { error: 'Too many attempts. Wait a few minutes and try again.' } });

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', limiter(20, 15 * 60 * 1000), require('./routes/auth'));
  app.use('/api', limiter(300, 15 * 60 * 1000));
  app.use('/api/onboarding', require('./routes/onboarding'));
  app.use('/api/mod', require('./routes/moderation'));
  app.use('/api', require('./routes/social'));

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // Express 5 forwards async errors here.
  app.use((err, req, res, next) => {
    if (err instanceof ZodError)
      return res.status(400).json({ error: err.issues[0]?.message || 'Invalid input', issues: err.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must be valid JSON' });
    if (err.code === '23514') return res.status(400).json({ error: 'That value is not allowed.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our side.' });
  });

  return app;
}

module.exports = { createApp };
