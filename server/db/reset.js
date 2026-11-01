// Drops and recreates all tables. Uses the DIRECT (unpooled) connection, as Neon
// recommends for schema changes.
require('../src/env');
const fs = require('fs');
const path = require('path');
const { pool, makePool, directUrl } = require('../src/db');

(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database');
  const direct = makePool(directUrl());
  try {
    await direct.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    console.log('Database schema created.');
  } finally {
    await direct.end();
    await pool.end();
  }
})().catch(err => { console.error(err.message); process.exit(1); });
