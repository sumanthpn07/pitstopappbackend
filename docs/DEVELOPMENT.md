# Backend — Development & Setup

NestJS + Prisma + PostgreSQL API for PitStop. Auth uses our own JWT/refresh
session; phone/Google verification is done by Firebase on the client and the
ID token is exchanged here (`POST /auth/firebase`).

## Prerequisites
- Node.js ≥ 20 and pnpm (`corepack enable`)
- Docker (for the Postgres container, or the all-in-one stack below)

## 1. Environment variables

Copy the template and fill it in:

```bash
cp .env.example .env
```

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. For the docker compose db use `postgresql://pitstop:pitstop@localhost:5434/pitstop?schema=public`. |
| `PORT` | no (4000) | API port. |
| `CORS_ORIGINS` | no (`*`) | Comma-separated allowed origins. |
| `JWT_SECRET` | yes (prod) | Signing secret for access tokens. Use a long random string in prod. |
| `JWT_ACCESS_TTL` | no (900) | Access-token lifetime, seconds. |
| `JWT_REFRESH_TTL_DAYS` | no (30) | Refresh-token lifetime, days. |
| `OTP_TTL` | no (300) | Dev-OTP code lifetime, seconds. |
| `OTP_EXPOSE_DEV_CODE` | no (true) | Return the dev OTP in the response (demo only — never in prod). |
| `LOG_REQUESTS` | no (false) | Log every request + response. Handy in dev. |
| `FIREBASE_CREDENTIALS_FILE` | for Firebase login | Path to the Firebase service-account JSON (see below). Unset = `/auth/firebase` returns `503 FIREBASE_NOT_CONFIGURED`. |
| `DEFAULT_SHOP_ID` | no | Shop a brand-new customer is attached to. |

**To add a new variable:** add it to `src/config/configuration.ts` (the
`AppConfiguration` interface + the factory that reads `process.env`), document it
in `.env.example`, then read it via `ConfigService` (e.g. `config.getOrThrow('your.key')`).

### Firebase service account (for Google / phone token verification)
Firebase console → Project settings → **Service accounts** → *Generate new private
key*. Save it as `secrets/firebase-service-account.json` and set:

```
FIREBASE_CREDENTIALS_FILE="./secrets/firebase-service-account.json"
```

`secrets/` and `.env` are gitignored — never commit them.

## 2. Run

### Docker (recommended) — one command
Brings up Postgres + the API, runs migrations, seeds demo data, serves on `:4000`:

```bash
docker compose up --build
```

Fully clean slate (wipes the DB volume):

```bash
docker compose down -v && docker compose up --build
```

Override ports / config without editing files:

```bash
API_PORT=5000 docker compose up --build          # change API port
DB_PORT=5500  docker compose up --build           # change DB host port
JWT_SECRET=xyz LOG_REQUESTS=false docker compose up --build
```

Logs: `docker compose logs -f api`.

### Local (without Docker)
```bash
docker compose up -d db          # just Postgres
pnpm install
pnpm prisma migrate deploy
pnpm db:seed
pnpm dev                          # watch mode on http://localhost:4000
```

## 3. Sample logins
The dev OTP is returned in the response (`OTP_EXPOSE_DEV_CODE=true`):

| Role | Phone |
|---|---|
| Manager (Anita) | `+919000000001` |
| Employee (Ravi / Priya) | `+919000000002` / `+919000000003` |
| Customer | any other number (auto-provisioned) |

## 4. Smoke tests (dev only)

These verify the auth/identity chain end-to-end against a **running** API,
without the mobile app. They need: the API up (`:4000`), the Firebase service
account in `secrets/`, and your Firebase **Web API key** (from
`google-services.json` `client[0].api_key[0].current_key`, or Firebase console).

```bash
# Login: mint a Firebase token, exchange it, fetch /me
node scripts/test-firebase-login.js "+919000000001" "<WEB_API_KEY>"

# Account merge: two accounts → link → assert lossless merge + no duplicates
node scripts/test-merge.js "<WEB_API_KEY>"

# Unlink: remove a method, assert the last one is protected
node scripts/test-unlink.js "<WEB_API_KEY>"
```

Each script cleans up the test users it creates.

## Notes
- The migration `20260617..._auth_identities` makes `User.phone` **nullable /
  non-unique** and adds the `AuthIdentity` table (one row per login method). It
  backfills a `PHONE` identity for every existing user.
- `/auth/otp/*` (dev OTP) is kept as a fallback alongside `/auth/firebase`.
