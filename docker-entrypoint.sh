#!/bin/sh
# Bring the schema up to date and seed demo data, then start the API.
# Both steps are idempotent, so restarting the container is safe.
set -e

echo "→ Applying migrations…"
pnpm prisma migrate deploy

echo "→ Seeding demo data…"
pnpm prisma db seed

echo "→ Starting PitStop API…"
exec node dist/main.js
