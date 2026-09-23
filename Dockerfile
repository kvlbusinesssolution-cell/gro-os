# Multi-stage production Docker build for this Next.js 16 app, following
# node_modules/next/dist/docs/01-app/02-guides/self-hosting.md's
# standalone-output pattern (next.config.ts sets `output: "standalone"`).
#
# Build:  docker build -t kvl-growthos .
# Run:    docker run -p 3000:3000 --env-file .env kvl-growthos
# (or use docker-compose.yml, which wires real postgres/redis services.)

# ---------- deps: install once, reused by the build stage's cache ----------
FROM node:20-alpine AS deps
WORKDIR /app

# openssl is required by Prisma's query engine on Alpine (musl) images.
RUN apk add --no-cache openssl

COPY package.json package-lock.json prisma.config.ts ./
# package.json's postinstall script runs `prisma generate`, which needs the
# real schema (and prisma.config.ts, which points at it — see that file's
# own "Loaded Prisma config from prisma.config.ts" log line) — copy both in
# before `npm ci` runs, or postinstall fails with "Could not find Prisma
# Schema" before any dependency is even usable.
COPY prisma ./prisma
RUN npm ci

# ---------- build: compile the real Next.js production build ----------
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Real values are unnecessary at build time beyond what `next build`
# genuinely needs to type-check/prerender — this app is designed to degrade
# honestly to "Not Configured" for every optional integration (see
# .env.example), so a syntactically valid placeholder DATABASE_URL is
# enough for the build step itself. Real secrets are supplied at container
# runtime (see docker-compose.yml / the `runner` stage below), never baked
# into the image.
ENV NEXT_TELEMETRY_DISABLED=1
ARG DATABASE_URL="postgresql://user:password@localhost:5432/kvl_growthos?schema=public"
ENV DATABASE_URL=${DATABASE_URL}

# `next build`'s own "Running TypeScript..." step type-checks the whole
# project in a single worker process — this codebase has grown large enough
# that Node's default ~2GB heap is no longer enough for that step alone
# (verified: OOM-kills mid-build otherwise), independent of how much memory
# the running app itself needs at runtime. Build-time only — never applied
# to the runner stage below.
ENV NODE_OPTIONS="--max-old-space-size=4096"

RUN npx prisma generate
RUN npm run build

# ---------- runner: minimal production image ----------
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Non-root user — standard Next.js standalone-output pattern.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# `output: "standalone"` traces the minimal production dependency subset
# into .next/standalone (including a generated server.js) and copies static
# assets separately into .next/static — see next.config.ts and the
# self-hosting guide referenced above.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# pdfkit is excluded from the standalone trace (serverExternalPackages in
# next.config.ts — it reads .afm font files from disk via native `require`,
# which tracing/bundling would break) so its real package files must be
# copied in explicitly, not just relied on the standalone trace. fontkit
# (a pdfkit dependency, also used directly by the CV Builder for real glyph-
# coverage checks) gets the same explicit copy for the same reason.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pdfkit ./node_modules/pdfkit
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/fontkit ./node_modules/fontkit

# Same reason as pdfkit above: the CV Builder's embedded Unicode font
# (src/lib/career/cv-pdf-renderer.ts) is read from disk at runtime via
# fs.readFile(path.join(process.cwd(), ...)), not imported as a JS module —
# standalone tracing never sees it, so it must be copied explicitly too.
COPY --from=builder --chown=nextjs:nodejs /app/assets ./assets

# Real uploaded-document storage (docker-compose.yml mounts a named volume
# at /app/storage/documents). Docker only inherits ownership/permissions
# from the image into a NEW named volume on its first mount — if this
# directory doesn't already exist with the right owner before that first
# mount, Docker auto-creates it as root:root, and the non-root `nextjs`
# process below can never write to it (a real functional bug, not just a
# health-check cosmetic one — document uploads would silently fail).
RUN mkdir -p /app/storage/documents && chown -R nextjs:nodejs /app/storage

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
