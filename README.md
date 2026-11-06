# Velvet: Safety-First Dating App

Velvet is a full-stack dating app where every member is ID-verified and screened for safety before they can see or message anyone. It focuses on the trust and safety design: identity verification, background screening with consent, and human review of flagged accounts, so that no one is publicly accused on the basis of a look-alike photo or a shared name.

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

**Try it**
- Live app: **https://velvet-dating-app-lon3.onrender.com** (also at https://jody2905.github.io/velvet-dating-app/). The first visit can take up to a minute while the free server wakes up.
- Sign in as a sample member: `amara@example.com` or `kai@example.com`, password `velvet-demo-pass`, to see a match and a chat. Or create your own account (any photo works for the ID and selfie steps; the verification provider is a test service).
- Moderators use **Staff sign-in** in the footer.
- To see what happens when screening finds something, add `?scenario=registry` (or `warrant`, `mismatch`) to the address before signing up.
- Add `?demo` to the address, or open `index.html` from your computer, to run everything in the page with sample data and no server.

## Design principles

1. **Match on verified identity, not looks.** Checks use the legal name and date of birth from a verified ID. Face similarity alone never triggers action.
2. **Humans decide.** Any hit goes to a trained moderator, never straight to other users.
3. **Due process.** False matches are cleared quietly, and people can dispute a decision.
4. **Data minimisation.** ID images are deleted after verification; only the result and a reference are kept.

## Run it

**Full app (live mode)** needs Node.js 20+ and a free [Neon](https://neon.tech) Postgres database:

```bash
git clone https://github.com/Jody2905/velvet-dating-app.git
cd velvet-dating-app/server
npm install
cp .env.example .env        # paste your Neon connection string, set JWT_SECRET
npm run db:reset && npm run db:seed
npm run dev                 # open http://localhost:3000
```

Sign in as `amara@example.com` or `kai@example.com` (password `velvet-demo-pass`) to see an existing match and chat, or create a new account. The moderator account is `mod@example.com` with the same password. To watch a new match form, like Simone from a new account, then sign in as `simone@example.com` in a private window and like back.

**Demo mode only:** open `index.html` in a browser.

## Deploy the full stack for free (Render + Neon)

1. **Database:** in [Neon](https://neon.tech), open your `velvet` project → **Connect**, and copy the **pooled** connection string (the host contains `-pooler`).
2. **API:** on [Render](https://render.com), choose **New → Blueprint** and pick this repo. `render.yaml` sets up a free web service called `velvet-api`. When asked, paste the Neon string as `DATABASE_URL` and choose a private `MOD_PASSWORD` for the moderator account.
3. The first start creates the tables and the demo members automatically (`server/db/setup.js`, which never drops data). Check `https://velvet-dating-app-lon3.onrender.com/api/health` shows `{"ok":true}`.
4. **Front end:** GitHub Pages (Settings → Pages → Deploy from branch `main`, `/ (root)`) serves `index.html`, which connects to the live API by itself. If Render gave your service a different URL, change `HOSTED_API` near the top of the script in `index.html`.

Free Render services sleep after 15 minutes without visitors and take about a minute to wake, so the first visit shows demo data until the server answers. On the live site, members use the demo password above; the moderator uses your `MOD_PASSWORD`.

## Backend API

The [`server/`](server/) folder has the Node.js + Express + PostgreSQL API: accounts, verification results, consent-based screening, matching, chat, reports and the moderator queue, with 17 end-to-end tests that run on GitHub Actions. It also serves the front end with a strict nonce-based Content Security Policy. See [server/README.md](server/README.md) for endpoints and the security rules it enforces.

## Project structure

```
index.html              Front end (live mode via the API, demo mode on GitHub Pages)
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
- [x] Front end connected to the API (with offline demo fallback)
- [ ] ID-verification provider (e.g. Persona, Onfido, Veriff) in sandbox mode
- [ ] Licensed background-check provider with rules per country
- [ ] Real-time chat (WebSockets) and video
- [x] Deploy API and database (Render + Neon) with GitHub Pages connected to it

## Tech

Front end: HTML, CSS, vanilla JavaScript. Back end: Node.js, Express 5, PostgreSQL on Neon, Zod, bcrypt, JWT, Helmet. Tests: node:test + Supertest. CI: GitHub Actions.

All data in this project is fictional.

## Author

Jody-Ann Trimmingham · [GitHub @Jody2905](https://github.com/Jody2905)
