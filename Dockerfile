# ---- Build Stage ----
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY tsconfig.json tsup.config.ts ./
COPY src/ ./src/
RUN pnpm build

# ---- Production Stage ----
FROM node:22-alpine AS production
WORKDIR /app

# Security: run as non-root
RUN addgroup -S app && adduser -S app -G app
USER app

COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/package.json ./

# Expose nothing — drain-ts is a library, not a server
# Users mount this image or use it as a base

LABEL org.opencontainers.image.title="@agentix-e/drain-ts"
LABEL org.opencontainers.image.description="Production-ready Drain3 log template miner for TypeScript"
LABEL org.opencontainers.image.source="https://github.com/AgentiX-E/drain-ts"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.authors="Lambertyan <lambertyan@agentix-e.dev>"

CMD ["node", "-e", "console.log('@agentix-e/drain-ts ready. Use import from dist/')"]
