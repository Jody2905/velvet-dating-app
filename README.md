# Velvet: Safety-First Dating App Prototype

Velvet is an interactive prototype of a dating app where every member is ID-verified and screened for safety before they can see or message anyone. It focuses on the trust and safety design: identity verification, background screening with consent, and human review of flagged accounts, so that no one is publicly accused on the basis of a look-alike photo or a shared name.

![Member app](screenshot-app.png)
![Moderator queue](screenshot-moderator.png)

## Features

**Member app**
- Signup with legal name and date of birth (under-18s are blocked)
- Government ID upload and live-selfie verification step
- Explicit consent screen for safety screening
- Step-by-step checks: ID authenticity, selfie match, sex-offender registries, wanted notices and sanctions lists, criminal records
- Discovery cards with "ID verified" badges, likes, matches, and chat
- In-chat safety tools: video call before meeting, "share my date" with a trusted contact, report and block
- Scam-pattern nudges (money requests or phone numbers shared early)

**Moderator queue**
- Flagged accounts are held and hidden from discovery, and no other member is notified
- Field-by-field comparison of the verified identity against the matched record
- Actions: confirm and suspend, clear as a false match, or request a re-check
- Member reports feed into the same queue

**Demo controls**
- Switch the screening result between *All clear*, *Registry match*, *Watchlist match* and *Selfie mismatch*
- An audit log shows what the backend would record at each step

## Design principles

1. **Match on verified identity, not looks.** Checks use the legal name and date of birth from a verified ID. Face similarity alone never triggers action.
2. **Humans decide.** Any hit goes to a trained moderator, never straight to other users.
3. **Due process.** False matches are cleared quietly, and people can dispute a decision.
4. **Data minimisation.** ID images are deleted after verification; only the result and a reference are kept.

## Run the front end

The prototype is a single self-contained HTML file with no build step:

```bash
git clone https://github.com/Jody2905/velvet-dating-app.git
cd velvet-dating-app
open index.html   # or double-click it
```

Or enable **GitHub Pages** (Settings → Pages → Deploy from branch → `main` / root) to host it for free.

## Backend API

The [`server/`](server/) folder has the Node.js + Express + PostgreSQL API: accounts, verification results, consent-based screening, matching, chat, reports and the moderator queue, with 16 end-to-end tests that run on GitHub Actions. See [server/README.md](server/README.md) for setup, endpoints and the security rules it enforces.

## Project structure

```
index.html              Front-end prototype (GitHub Pages)
server/
  db/schema.sql         PostgreSQL tables, constraints, append-only audit trigger
  db/seed.js            Fictional demo data
  src/routes/           auth, onboarding, social (discover/likes/chat/reports), moderation
  src/services/         screening provider adapter, message safety checks
  test/api.test.js      End-to-end tests
.github/workflows/      CI: runs the tests against PostgreSQL on every push
```

## Roadmap

- [x] Interactive front-end prototype
- [x] PostgreSQL schema and REST API with role-based access
- [x] Automated tests and CI
- [ ] Connect the front end to the API
- [ ] ID-verification provider (e.g. Persona, Onfido, Veriff) in sandbox mode
- [ ] Licensed background-check provider with rules per country
- [ ] Real-time chat (WebSockets) and video
- [ ] Deploy API and database (Render or Railway)

## Tech

Front end: HTML, CSS, vanilla JavaScript. Back end: Node.js, Express 5, PostgreSQL, Zod, bcrypt, JWT, Helmet. Tests: node:test + Supertest. CI: GitHub Actions.

All data in this project is fictional.

## Author

Jody-Ann Trimmingham · [GitHub @Jody2905](https://github.com/Jody2905)
