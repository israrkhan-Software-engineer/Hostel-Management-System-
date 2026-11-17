# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22.14.0-alpine3.21 AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci
COPY . .
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build DATABASE_MIGRATION_URL=postgresql://build:build@localhost:5432/build npm run db:generate
RUN npx tsc --target ES2021 --module commonjs --esModuleInterop --skipLibCheck --rootDir . --outDir dist-seed prisma/seed.ts
RUN npm run build

# One-shot deployment stage retains Prisma CLI and build-time dependencies.
FROM builder AS migrator
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM builder AS production-dependencies
RUN npm prune --omit=dev

FROM node:22.14.0-alpine3.21 AS production
WORKDIR /app
RUN apk add --no-cache openssl

RUN addgroup -S hms && adduser -S hms -G hms

COPY --from=production-dependencies --chown=hms:hms /app/node_modules ./node_modules
COPY --from=builder --chown=hms:hms /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder --chown=hms:hms /app/dist-seed ./dist-seed
COPY --from=builder --chown=hms:hms /app/package.json .

USER hms
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/api/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "dist/src/main"]
