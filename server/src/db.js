const { Pool, types } = require('pg');

// Return DATE columns as 'YYYY-MM-DD' strings instead of JS Dates (avoids timezone shifts).
types.setTypeParser(1082, v => v);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Run several queries in one transaction.
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function audit(db, actorId, action, targetId, meta = {}) {
  await db.query(
    'INSERT INTO audit_log (actor_id, action, target_id, meta) VALUES ($1, $2, $3, $4)',
    [actorId, action, targetId == null ? null : String(targetId), meta]
  );
}

module.exports = { pool, tx, audit };
