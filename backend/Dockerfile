# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci
COPY . .
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build DATABASE_MIGRATION_URL=postgresql://build:build@localhost:5432/build npm run db:generate
RUN npx tsc --target ES2021 --module commonjs --esModuleInterop --skipLibCheck --rootDir . --outDir dist-seed prisma/seed.ts
RUN npm run build

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app
RUN apk add --no-cache openssl

# Non-root user (security hardening 🟡)
RUN addgroup -S hms && adduser -S hms -G hms

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-seed ./dist-seed
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json .
COPY --from=builder /app/src ./src

USER hms
EXPOSE 3001
CMD ["node", "dist/src/main"]
