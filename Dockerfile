# Use the official Bun image with a specific version for reproducibility
FROM oven/bun:1.2-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code and environment file
COPY . .

# Run database migrations (ensure DATABASE_URL is set)
RUN bun run db:migrate

# Expose port
EXPOSE 3000

# Run the app
CMD ["bun", "run", "src/index.ts"]