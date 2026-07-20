# B2 Consultants — production image for the VPS.
#
# Three stages, and the split matters:
#   deps  — npm ci once, cached until package-lock.json changes
#   build — full toolchain + prisma CLI + migrations. Also the image the compose
#           `migrate` service runs `prisma migrate deploy` from (see the note below).
#   run   — the slim standalone server. No prisma CLI, no dev deps, non-root.
#
# WHY MIGRATIONS ARE NOT IN THIS FILE ANYMORE:
# `npm run build` used to be `prisma generate && prisma migrate deploy && next build`,
# which meant `docker build` needed a live, reachable database and would fail on a
# clean VPS with P1001. Migrations are a *release* step, not a *build* step — an image
# must build identically whether or not a database exists. They now run once per deploy
# from the compose `migrate` service, which targets the `build` stage below (it already
# has the CLI, the engines and prisma/migrations, so the runtime image stays slim).

FROM node:20-alpine AS deps
WORKDIR /app
# Prisma's engines link against OpenSSL; without it the linux-musl engine fails to load.
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
# Opts into `output: "standalone"` + outputFileTracing in next.config.mjs. Local
# (non-Docker) builds deliberately leave both off.
ENV NEXT_OUTPUT_STANDALONE=1
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No DATABASE_URL needed: `prisma generate` reads the schema, not the database.
RUN npm run build

FROM node:20-alpine AS run
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# The standalone bundle is traced, not installed — it already contains only the
# server deps it actually reached (incl. mammoth / pdf-parse / @react-pdf/renderer,
# which next.config.mjs externalises).
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# The generated client's query engine — tracing does not always pick up the binary.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# node:alpine ships an unprivileged `node` user (uid 1000). The app writes nothing to
# disk at runtime (CV parsing and PDF rendering are both in-memory), so it can run
# read-only — see `read_only: true` in docker-compose.prod.yml.
USER node

EXPOSE 3000
CMD ["node", "server.js"]
