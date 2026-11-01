# Velvet API

Node.js + Express + PostgreSQL backend for Velvet: accounts, ID verification results, consent-based safety screening, matching, chat, reports and the moderator review queue.

## Quick start

You need Node.js 20+ and a PostgreSQL database. The easiest option is [Neon](https://neon.tech) (free, nothing to install).

```bash
cd server
npm install
cp .env.example .env          # paste your Neon connection string into DATABASE_URL, set JWT_SECRET
npm run db:reset              # creates the tables (uses Neon's direct connection)
npm run db:seed               # adds fictional demo members and two review cases
npm run dev                   # open http://localhost:3000 for the full app
```

With the Neon CLI you can fill in the connection strings automatically: `neon env pull` (the project is linked in `.neon` and `neon.ts`). Prefer local Postgres? `docker compose up -d` starts one that matches the commented example in `.env.example`.

**Connections:** the app uses Neon's pooled connection (`DATABASE_URL`, host contains `-pooler`) through `node-postgres`, since Express is a long-running server. Schema changes use the direct connection (`DATABASE_URL_UNPOOLED`, or derived automatically by dropping `-pooler`).

Demo logins (password `velvet-demo-pass`): `mod@example.com` (moderator), `amara@example.com`, `kai@example.com`, `simone@example.com`, `devon@example.com`.

### Tests

The tests **erase** the database they run on, so they only use `TEST_DATABASE_URL` and refuse to run against `DATABASE_URL`. Point it at a throwaway Neon branch:

```bash
neon checkout test --create          # creates a branch that auto-expires after 7 days
neon connection-string test          # copy this into TEST_DATABASE_URL in .env
npm test
```

`npm run build` syntax-checks every file and confirms the app loads. The tests reset the test database and run 17 end-to-end checks covering the safety rules below. They also run automatically on GitHub Actions on every push.

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
