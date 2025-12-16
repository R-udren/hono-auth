# Build stage
FROM oven/bun:alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install all dependencies (needed for build/type checking)
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# Copy source code
COPY . .

# Verify TypeScript compilation and prepare production files
RUN bun build src/index.ts --target=bun --outdir=dist && \
    mkdir -p /prod && \
    cp -r src drizzle drizzle.config.ts tsconfig.json /prod

# Production stage
FROM oven/bun:alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S bunuser -u 1001 -G nodejs

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install production dependencies only
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --production --frozen-lockfile

# Copy source code from builder
COPY --from=builder --chown=bunuser:nodejs /prod ./

# Switch to non-root user
USER bunuser

EXPOSE 3000

ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD bun run -e 'fetch("http://localhost:3000/").then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))'

ENTRYPOINT ["dumb-init", "--"]

CMD ["bun", "run", "src/index.ts"]