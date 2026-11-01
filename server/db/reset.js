// Drops and recreates all tables. Development only.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');

(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database');
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  console.log('Database schema created.');
  await pool.end();
})().catch(async err => { console.error(err.message); await pool.end(); process.exit(1); });
