# PitStop backend image: builds the NestJS app + Prisma client.
# Migrations and seed run at container start (see docker-entrypoint.sh).
FROM node:22-bookworm-slim

# Prisma needs openssl; tini gives clean signal handling.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Pin pnpm to the version the lockfile was written with.
RUN corepack enable && corepack prepare pnpm@11.6.0 --activate

# Install deps first (better layer caching).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Build the app + generate the Prisma client.
COPY . .
RUN pnpm prisma generate && pnpm build

EXPOSE 4000
ENTRYPOINT ["tini", "--"]
CMD ["sh", "docker-entrypoint.sh"]
