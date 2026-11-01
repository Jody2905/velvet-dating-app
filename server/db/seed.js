// Loads fictional demo data: one moderator, four active members, two open review cases.
// Run: npm run db:seed   (after npm run db:reset)
require('../src/env');
const bcrypt = require('bcryptjs');
const { pool, tx } = require('../src/db');
const { compare, severityFor } = require('../src/services/screening');

const PASSWORD = 'velvet-demo-pass';

const members = [
  { email: 'amara@example.com', name: 'Amara Joseph', dob: '1995-04-12', display: 'Amara', loc: 'Bequia', bio: 'Sunset sails, slow dinners, and a good debate.', tags: ['Sailing', 'Poetry', 'Soca'] },
  { email: 'kai@example.com', name: 'Kai Richards', dob: '1997-08-03', display: 'Kai', loc: 'Kingstown', bio: 'Chef by day. Will cook for you if the vibe is right.', tags: ['Cooking', 'Jazz', 'Hiking'] },
  { email: 'simone@example.com', name: 'Simone Baptiste', dob: '1996-01-20', display: 'Simone', loc: 'Calliaqua', bio: 'Nurse, beach walker, terrible at karaoke but goes anyway.', tags: ['Beach', 'Karaoke', 'Books'] },
  { email: 'devon@example.com', name: 'Devon Charles', dob: '1999-11-09', display: 'Devon', loc: 'Arnos Vale', bio: 'Engineer who still writes love letters by hand.', tags: ['Cricket', 'Film', 'Travel'] },
];

const held = [
  { email: 'marcus@example.com', name: 'Marcus Anthony Thorne', dob: '1988-03-11', display: 'Marcus', list: 'sex_offender_registry', record: { name: 'Marcus Anthony Thorne', dob: '1988-03-11' } },
  { email: 'andre@example.com', name: 'Andre Williams', dob: '1996-07-22', display: 'Andre', list: 'public_wanted_notice', record: { name: 'Andre Williams', dob: '1971-01-04' } },
];

(async () => {
  const hash = await bcrypt.hash(PASSWORD, 12);
  await tx(async db => {
    const addUser = async (u, role, status) => {
      const { rows: [r] } = await db.query(
        `INSERT INTO users (email, password_hash, legal_name, date_of_birth, role, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [u.email, hash, u.name, u.dob, role, status]);
      await db.query(`INSERT INTO verifications (user_id, id_document, selfie_liveness, provider, provider_ref, verified_at)
                      VALUES ($1,'passed','passed','mock','seed',now())`, [r.id]);
      if (u.display) await db.query('INSERT INTO profiles (user_id, display_name, location, bio, interests) VALUES ($1,$2,$3,$4,$5)',
        [r.id, u.display, u.loc || null, u.bio || null, u.tags || []]);
      return r.id;
    };

    await addUser({ email: 'mod@example.com', name: 'Velvet Moderator', dob: '1990-01-01' }, 'moderator', 'active');
    const ids = {};
    for (const m of members) ids[m.display] = await addUser(m, 'member', 'active');

    // Amara and Kai already matched and chatting, so signing in as either shows a conversation.
    const [a, b] = [ids.Amara, ids.Kai].sort();
    await db.query('INSERT INTO likes (liker_id, liked_id) VALUES ($1,$2), ($2,$1)', [ids.Amara, ids.Kai]);
    const { rows: [match] } = await db.query('INSERT INTO matches (user_a, user_b) VALUES ($1,$2) RETURNING id', [a, b]);
    const chat = [
      [ids.Kai, 'Saw you like sailing. Ever been out to the Tobago Cays?'],
      [ids.Amara, 'Twice! Best water in the world. You cook, right? I might need proof.'],
      [ids.Kai, 'Name the dish and the day 😄'],
    ];
    for (const [sender, body] of chat)
      await db.query('INSERT INTO messages (match_id, sender_id, body) VALUES ($1,$2,$3)', [match.id, sender, body]);

    // To see a new match form: like Simone from a new account, then sign in as Simone and like back.
    for (const h of held) {
      const id = await addUser(h, 'member', 'under_review');
      const comparison = compare({ legal_name: h.name, date_of_birth: h.dob }, h.record);
      await db.query(`INSERT INTO review_cases (subject_id, source, severity, details) VALUES ($1,$2,$3,$4)`,
        [id, 'screening:' + h.list, severityFor(comparison), JSON.stringify({ comparison })]);
    }
  });
  console.log(`Seeded. All demo accounts use the password "${PASSWORD}".`);
  console.log('Moderator: mod@example.com   Members: amara@, kai@, simone@, devon@example.com');
  await pool.end();
})().catch(async err => { console.error(err); await pool.end(); process.exit(1); });
