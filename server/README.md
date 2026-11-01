# Velvet API

Node.js + Express + PostgreSQL backend for Velvet: accounts, ID verification results, consent-based safety screening, matching, chat, reports and the moderator review queue.

## Quick start

You need Node.js 20+ and PostgreSQL (or Docker).

```bash
cd server
npm install
cp .env.example .env          # then set JWT_SECRET (see the comment in the file)
docker compose up -d          # starts PostgreSQL on port 5432 (skip if you have Postgres installed)
npm run db:reset              # creates the tables
npm run db:seed               # adds fictional demo members and two review cases
npm run dev                   # open http://localhost:3000 for the full app
```

Demo logins (password `velvet-demo-pass`): `mod@example.com` (moderator), `amara@example.com`, `kai@example.com`, `simone@example.com`, `devon@example.com`.

### Tests

```bash
createdb velvet_test   # or: docker compose exec db createdb -U velvet velvet_test
TEST_DATABASE_URL=postgres://velvet:velvet@localhost:5432/velvet_test npm test
```

The tests reset the test database and run 17 end-to-end checks covering the safety rules below. They also run automatically on GitHub Actions on every push.

## Account lifecycle

```
register → pending ──verify ID + selfie──► screening ──clear──► active
                                               │
                                               └─hit──► under_review ──moderator──► active (cleared)
                                                                               └──► suspended
```

## Endpoints

All endpoints except register, login and health need `Authorization: Bearer <token>`.

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/` | anyone | The front end (`../index.html`) with a nonce-based CSP |
| POST | `/api/auth/register` | anyone | Create account (18+ only) |
| POST | `/api/auth/login` | anyone | Get a token |
| GET | `/api/auth/me` | member | Your account, verification and profile |
| PUT | `/api/onboarding/profile` | member | Create or update your public profile |
| POST | `/api/onboarding/verification` | member | Record ID + selfie result (provider webhook in production) |
| POST | `/api/onboarding/screening` | member | Run screening with `{ "consent": true }` |
| GET | `/api/discover` | active member | Verified, active members you haven't liked or blocked |
| POST | `/api/likes/:userId` | active member | Like; returns `matched` and `matchId` when mutual |
| GET | `/api/matches` | active member | Your matches |
| GET/POST | `/api/matches/:id/messages` | match participants | Read or send messages (scam patterns get a warning) |
| POST | `/api/blocks/:userId` | active member | Block and unmatch |
| POST | `/api/reports/:userId` | active member | Report (also blocks); opens a review case |
| GET | `/api/mod/cases?status=open` | moderator | Review queue |
| POST | `/api/mod/cases/:id/decision` | moderator | `{ "decision": "suspend" \| "clear" \| "recheck", "note": "..." }` |
| GET | `/api/mod/audit` | moderator | Latest audit log entries |

In demo mode (`DEMO_MODE=true`) you can pass `"scenario": "registry"` or `"watchlist"` to the screening call to simulate a hit.

## Safety and security rules (enforced and tested)

- **Identity, not looks.** Screening compares the verified legal name and date of birth. Exact name + DOB = high severity; name only = medium (probably a different person, but still reviewed).
- **No public accusations.** A hit hides the account and opens a case. The member only sees "needs review"; other members are told nothing.
- **Humans decide.** Only moderators can suspend or clear, and every decision needs a note.
- **Private identity.** Legal name and DOB never appear in discovery, matches or chat; age is calculated on the server.
- **Reporter anonymity.** Moderators see the report, not who filed it.
- **18+ enforced twice.** In the API and by a database constraint.
- **Append-only audit log.** A database trigger blocks UPDATE and DELETE.
- **Strict Content Security Policy.** The page is served with a fresh nonce per request, so only its own script can run; all member content is HTML-escaped before display.
- **Hardened API.** bcrypt password hashing, short-lived JWTs, account status re-checked on every request (suspensions apply at once), input validation with Zod, Helmet headers, CORS allow-list, rate limiting on login, and a 20 KB request body limit.
- **No ID images stored.** Only the provider's reference and pass/fail result.

## Next steps

- Replace the mock screening provider in `src/services/screening.js` with a real one in sandbox mode
- Receive verification results through a signed provider webhook
- Real-time chat over WebSockets
