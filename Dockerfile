# syntax=docker/dockerfile:1
# Vigor production image: Next.js standalone server + SQLite on a persistent /data volume.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Toolchain only used if no prebuilt better-sqlite3 binary matches the platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    VIGOR_DATA_DIR=/data
RUN groupadd --system --gid 1001 vigor && useradd --system --uid 1001 --gid vigor --home /app vigor \
    && mkdir -p /data && chown vigor:vigor /data
COPY --from=build --chown=vigor:vigor /app/.next/standalone ./
COPY --from=build --chown=vigor:vigor /app/.next/static ./.next/static
COPY --from=build --chown=vigor:vigor /app/samples ./samples
USER vigor
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
