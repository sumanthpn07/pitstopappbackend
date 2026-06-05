# PitStop Backend

The backend for the **PitStop** car-wash & detailing app — a **NestJS + Prisma + PostgreSQL** service that implements the exact REST contract the mobile app's `HttpApi` client already speaks.

It is fully standalone: it does not import from or depend on the mobile app. The app keeps working on its in-memory mock until you point it here.

## Stack

- **NestJS 10** (modular controllers, DI, guards, global validation)
- **Prisma 6** ORM over **PostgreSQL 16**
- **JWT** auth (access token) + rotating opaque **refresh tokens**
- Phone **OTP** sign-in (code returned in the API response in dev)
- **Luxon** for timezone-correct availability slots (Asia/Kolkata)

## Prerequisites

- Node.js ≥ 18
- Docker (for the Postgres container) — or your own PostgreSQL

## Quick start

```bash
# 1. Start Postgres (host port 5434; set DB_PORT to change)
docker compose up -d --wait

# 2. Configure env
cp .env.example .env

# 3. Install deps + generate the Prisma client
npm install

# 4. Create the schema and seed demo data
npm run prisma:migrate      # first run: name the migration e.g. "init"
npm run db:seed

# 5. Run it
npm run dev                 # http://localhost:4000
```

`npm run setup` runs generate + deploy + seed in one go (after the DB is up).

## Sample logins

The OTP is returned in the response body in dev (`OTP_EXPOSE_DEV_CODE=true`), so no SMS is needed.

| Role | Phone |
|------|-------|
| Manager (Anita) | `+919000000001` |
| Employee (Ravi) | `+919000000002` |
| Employee (Priya) | `+919000000003` |
| Customer | any other number (auto-provisioned) |

Demo customer `+919812300000` (Aarav) is seeded with bookings spanning every status.

## Connecting the mobile app

In the app's `.env`, switch off the mock and point at this server (use your LAN IP for a physical device):

```
EXPO_PUBLIC_USE_MOCK=false
EXPO_PUBLIC_API_URL=http://<your-mac-lan-ip>:4000
```

No app code changes are required — the `HttpApi` implementation already targets these routes.

## API surface

All errors are returned as `{ "error": { "code", "message" } }`. Auth is `Authorization: Bearer <accessToken>`.

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /auth/otp/request` | public | Request an OTP for a phone |
| `POST /auth/otp/verify` | public | Verify OTP → `{ accessToken, refreshToken, expiresIn }` |
| `POST /auth/refresh` | public | Rotate a refresh token |
| `GET /me` | any | Current user + memberships |
| `GET /shop` | public | Shop profile |
| `GET /services` | public | Active services |
| `GET /availability?serviceId=&date=` | public | Bookable slots for a day |
| `GET /vehicles` · `POST /vehicles` | customer | List / add vehicles |
| `GET /bookings` · `POST /bookings` | customer | List / create bookings |
| `GET /bookings/:id` | owner or staff | Booking detail |
| `POST /bookings/:id/cancel` | customer | Cancel a booking |
| `POST /condition-reports/:id/verify` | customer | Approve pickup/delivery photos |
| `GET /manage/bookings` | manager | All shop bookings |
| `GET /manage/services` | manager | All services (incl. hidden) |
| `GET /manage/staff` | manager | Employees + task load |
| `POST /manage/bookings/:id/assign` | manager | Assign pickup / service staff |
| `POST /manage/services` · `PATCH /manage/services/:id` | manager | Create / edit services |
| `GET /manage/working-hours` · `PUT /manage/working-hours` | manager | Read / set hours |
| `GET /tasks` | employee | Assigned tasks |
| `POST /tasks/:id/condition-reports` | employee | Submit pickup/delivery photos |
| `PATCH /tasks/:id/checklist/:itemId` | employee | Tick a checklist step |

## Booking lifecycle (gates enforced server-side)

`BOOKED → ASSIGNED → CONDITION_PENDING → IN_PROGRESS → DONE_PENDING → COMPLETED`

- Manager assigns a service specialist → `ASSIGNED`
- Employee submits **pickup** photos → `CONDITION_PENDING`
- Customer approves → `IN_PROGRESS`
- Employee completes the checklist + submits **delivery** photos → `DONE_PENDING`
- Customer approves → `COMPLETED`

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start with watch/reload |
| `npm run build` / `npm run start:prod` | Compile / run compiled output |
| `npm run prisma:migrate` | Create + apply a dev migration |
| `npm run db:seed` | Seed demo data |
| `npm run db:reset` | Drop, re-migrate and re-seed |
| `npm run prisma:studio` | Browse the DB in Prisma Studio |
