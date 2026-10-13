# syntax=docker/dockerfile:1

# ---------- Dependencies (dev dependencies included: needed to build, to run the worker with tsx, and for migrations) ----------
FROM node:22-alpine AS deps
# openssl: Prisma's query/schema engines need it on Alpine (without it they fall back to a binary that fails to load).
# libc6-compat: recommended by Next.js for Alpine.
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json ./
# prisma/ must be present before `npm ci`: the postinstall script runs `prisma generate`
COPY prisma ./prisma
RUN npm ci

# ---------- Build ----------
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ---------- Database migrations (one-off) ----------
FROM node:22-alpine AS migrate
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

# ---------- Background worker ----------
FROM node:22-alpine AS worker
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --chown=nextjs:nodejs . .

USER nextjs
# Direct path instead of `npx`: no package lookup at start-up, and signals reach the process (graceful shutdown).
CMD ["node_modules/.bin/tsx", "scripts/start-worker.ts"]

# ---------- Web server (default target: keep this the LAST stage) ----------
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Listen on all interfaces. Docker sets HOSTNAME to the container id and some platforms leave it unset; the
# standalone server would then bind to one address (or localhost only) and be unreachable from outside.
ENV HOSTNAME=0.0.0.0
# Uploaded resumes. Writable by the non-root user; mount a persistent volume here if the host offers one.
ENV UPLOADS_DIR=/data/uploads
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs \
  && mkdir -p /data/uploads && chown -R nextjs:nodejs /data

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

USER nextjs
EXPOSE 3000

# Liveness only (no database/Redis involved) — see app/api/health/route.ts
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
