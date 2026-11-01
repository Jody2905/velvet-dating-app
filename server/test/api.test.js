// End-to-end API tests against a real PostgreSQL database.
// Uses TEST_DATABASE_URL (falls back to DATABASE_URL). The schema is reset before the run.
require('dotenv').config({ quiet: true });
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret-123';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const { createApp } = require('../src/app');

const app = createApp();
const api = () => request(app);
const auth = t => ({ Authorization: 'Bearer ' + t });

async function signup(email, name, dob, scenario = 'clear', display) {
  const r = await api().post('/api/auth/register').send({ email, password: 'correct-horse-battery', legalName: name, dateOfBirth: dob });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const t = r.body.token;
  await api().put('/api/onboarding/profile').set(auth(t)).send({ displayName: display || name.split(' ')[0], location: 'Kingstown', interests: ['Music'] }).expect(200);
  await api().post('/api/onboarding/verification').set(auth(t)).send({ providerRef: 'ref-' + email, idDocument: 'passed', selfieLiveness: 'passed' }).expect(200);
  const s = await api().post('/api/onboarding/screening').set(auth(t)).send({ consent: true, scenario });
  return { token: t, id: r.body.user.id, screening: s.body };
}

let mod, alice, bob;

before(async () => {
  await pool.query(fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8'));
  const hash = await bcrypt.hash('moderator-pass-123', 4);
  await pool.query(`INSERT INTO users (email, password_hash, legal_name, date_of_birth, role, status)
                    VALUES ('mod@test.dev', $1, 'Mod Erator', '1990-01-01', 'moderator', 'active')`, [hash]);
  const r = await api().post('/api/auth/login').send({ email: 'mod@test.dev', password: 'moderator-pass-123' });
  mod = r.body.token;
  alice = await signup('alice@test.dev', 'Alice Grant', '1995-02-02');
  bob = await signup('bob@test.dev', 'Bob Hayes', '1993-06-15');
});

after(() => pool.end());

test('rejects under-18 signups', async () => {
  const year = new Date().getFullYear() - 17;
  const r = await api().post('/api/auth/register').send({ email: 'kid@test.dev', password: 'correct-horse-battery', legalName: 'Too Young', dateOfBirth: `${year}-01-01` });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /18/);
});

test('validates input and rejects duplicate email', async () => {
  const bad = await api().post('/api/auth/register').send({ email: 'nope', password: 'short' });
  assert.equal(bad.status, 400);
  const dup = await api().post('/api/auth/register').send({ email: 'alice@test.dev', password: 'correct-horse-battery', legalName: 'Alice Two', dateOfBirth: '1990-01-01' });
  assert.equal(dup.status, 409);
});

test('login gives the same error for unknown email and wrong password', async () => {
  const a = await api().post('/api/auth/login').send({ email: 'ghost@test.dev', password: 'whatever-123' });
  const b = await api().post('/api/auth/login').send({ email: 'alice@test.dev', password: 'wrong-password' });
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.equal(a.body.error, b.body.error);
});

test('clear screening activates the account', async () => {
  assert.equal(alice.screening.status, 'active');
  const me = await api().get('/api/auth/me').set(auth(alice.token)).expect(200);
  assert.equal(me.body.status, 'active');
});

test('screening requires consent and verification first', async () => {
  const r = await api().post('/api/auth/register').send({ email: 'carl@test.dev', password: 'correct-horse-battery', legalName: 'Carl Dean', dateOfBirth: '1991-03-03' });
  const t = r.body.token;
  assert.equal((await api().post('/api/onboarding/screening').set(auth(t)).send({ consent: false })).status, 400);
  assert.equal((await api().post('/api/onboarding/screening').set(auth(t)).send({ consent: true })).status, 409);
});

test('pending members cannot browse', async () => {
  const r = await api().post('/api/auth/register').send({ email: 'dana@test.dev', password: 'correct-horse-battery', legalName: 'Dana Fox', dateOfBirth: '1992-04-04' });
  assert.equal((await api().get('/api/discover').set(auth(r.body.token))).status, 403);
});

test('discover never exposes legal name or date of birth', async () => {
  const r = await api().get('/api/discover').set(auth(alice.token)).expect(200);
  const bobCard = r.body.find(p => p.id === bob.id);
  assert.ok(bobCard, 'Bob should be discoverable');
  assert.equal(bobCard.legal_name, undefined);
  assert.equal(bobCard.date_of_birth, undefined);
  assert.equal(typeof bobCard.age, 'number');
  assert.equal(bobCard.verified, true);
});

test('mutual likes create a match, and chat flags scam patterns', async () => {
  const first = await api().post(`/api/likes/${bob.id}`).set(auth(alice.token)).expect(201);
  assert.equal(first.body.matched, false);
  const second = await api().post(`/api/likes/${alice.id}`).set(auth(bob.token)).expect(201);
  assert.equal(second.body.matched, true);
  const matchId = second.body.matchId;

  const ok = await api().post(`/api/matches/${matchId}/messages`).set(auth(alice.token)).send({ body: 'Hi Bob!' }).expect(201);
  assert.equal(ok.body.safety_flag, null);
  const scam = await api().post(`/api/matches/${matchId}/messages`).set(auth(bob.token)).send({ body: 'Can you send money via western union?' }).expect(201);
  assert.equal(scam.body.safety_flag, 'money_request');
  assert.ok(scam.body.warning);

  const list = await api().get(`/api/matches/${matchId}/messages`).set(auth(alice.token)).expect(200);
  assert.equal(list.body.length, 2);
});

test('outsiders cannot read a match they are not in', async () => {
  const eve = await signup('eve@test.dev', 'Eve Stone', '1994-05-05');
  const { rows: [m] } = await pool.query('SELECT id FROM matches LIMIT 1');
  assert.equal((await api().get(`/api/matches/${m.id}/messages`).set(auth(eve.token))).status, 404);
});

test('a screening hit hides the account and opens a case without notifying anyone', async () => {
  const flagged = await signup('frank@test.dev', 'Frank Miller', '1985-09-09', 'registry');
  assert.equal(flagged.screening.status, 'under_review');
  assert.doesNotMatch(JSON.stringify(flagged.screening), /registry|offender/i, 'member must not see what was found');

  const disc = await api().get('/api/discover').set(auth(alice.token)).expect(200);
  assert.ok(!disc.body.some(p => p.id === flagged.id), 'flagged account must be hidden');

  const cases = await api().get('/api/mod/cases').set(auth(mod)).expect(200);
  const c = cases.body.find(x => x.subject_id === flagged.id);
  assert.equal(c.severity, 'high');
  assert.equal(c.details.comparison.find(f => f.field === 'Date of birth').result, 'match');
});

test('name-only watchlist hit is medium severity and can be cleared', async () => {
  const g = await signup('grace@test.dev', 'Grace Ollivierre', '1998-12-12', 'watchlist');
  const cases = await api().get('/api/mod/cases').set(auth(mod)).expect(200);
  const c = cases.body.find(x => x.subject_id === g.id);
  assert.equal(c.severity, 'medium');

  await api().post(`/api/mod/cases/${c.id}/decision`).set(auth(mod)).send({ decision: 'clear', note: 'DOB differs, different person' }).expect(200);
  const me = await api().get('/api/auth/me').set(auth(g.token)).expect(200);
  assert.equal(me.body.status, 'active');
  const again = await api().post(`/api/mod/cases/${c.id}/decision`).set(auth(mod)).send({ decision: 'suspend', note: 'second try' });
  assert.equal(again.status, 409);
});

test('suspending locks the account out immediately', async () => {
  const h = await signup('hank@test.dev', 'Hank Pierre', '1980-10-10', 'registry');
  const { body } = await api().get('/api/mod/cases').set(auth(mod));
  const c = body.find(x => x.subject_id === h.id);
  await api().post(`/api/mod/cases/${c.id}/decision`).set(auth(mod)).send({ decision: 'suspend', note: 'Exact name and DOB confirmed' }).expect(200);
  assert.equal((await api().get('/api/auth/me').set(auth(h.token))).status, 403);
  assert.equal((await api().post('/api/auth/login').send({ email: 'hank@test.dev', password: 'correct-horse-battery' })).status, 403);
});

test('members cannot use moderator endpoints', async () => {
  assert.equal((await api().get('/api/mod/cases').set(auth(alice.token))).status, 403);
});

test('reporting blocks, unmatches, and opens a case without revealing the reporter', async () => {
  const ivy = await signup('ivy@test.dev', 'Ivy Cupid', '1996-06-06');
  await api().post(`/api/likes/${ivy.id}`).set(auth(alice.token)).expect(201);
  const m = await api().post(`/api/likes/${alice.id}`).set(auth(ivy.token)).expect(201);

  await api().post(`/api/reports/${ivy.id}`).set(auth(alice.token)).send({ reason: 'unsafe', details: 'Threatening messages' }).expect(201);

  assert.equal((await api().get(`/api/matches/${m.body.matchId}/messages`).set(auth(alice.token))).status, 404);
  const disc = await api().get('/api/discover').set(auth(alice.token));
  assert.ok(!disc.body.some(p => p.id === ivy.id));

  const me = await api().get('/api/auth/me').set(auth(ivy.token));
  assert.equal(me.body.status, 'under_review', 'serious reports hide the account until reviewed');

  const { body } = await api().get('/api/mod/cases').set(auth(mod));
  const c = body.find(x => x.subject_id === ivy.id);
  assert.equal(c.source, 'report:unsafe');
  assert.doesNotMatch(JSON.stringify(c), new RegExp(alice.id));
});

test('audit log is append-only', async () => {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM audit_log');
  assert.ok(rows[0].n > 10);
  await assert.rejects(pool.query('DELETE FROM audit_log'), /append-only/);
  await assert.rejects(pool.query("UPDATE audit_log SET action = 'x'"), /append-only/);
});

test('database rejects under-18 rows even if the API is bypassed', async () => {
  await assert.rejects(pool.query(
    `INSERT INTO users (email, password_hash, legal_name, date_of_birth) VALUES ('raw@test.dev', 'x', 'Raw Insert', CURRENT_DATE - INTERVAL '10 years')`
  ), /adult/);
});
