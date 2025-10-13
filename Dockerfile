# Build stage
FROM oven/bun:1.3-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install all dependencies (needed for build/type checking)
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Verify TypeScript compilation
RUN bun build src/index.ts --target=bun --outdir=dist

# Production stage
FROM oven/bun:1.3-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S bunuser -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install production dependencies only
RUN bun install --production --frozen-lockfile && \
    bun pm cache rm

# Copy source code from builder
COPY --from=builder --chown=bunuser:nodejs /app/src ./src
COPY --from=builder --chown=bunuser:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=bunuser:nodejs /app/drizzle.config.ts ./
COPY --from=builder --chown=bunuser:nodejs /app/tsconfig.json ./

# Switch to non-root user
USER bunuser

# Expose port
EXPOSE 3000

# Set environment to production
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD bun run -e 'fetch("http://localhost:3000/").then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))'

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Run the app
CMD ["bun", "run", "src/index.ts"]