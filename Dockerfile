# Use the official Bun image with a specific version for reproducibility
FROM oven/bun:1.2-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies (including dev deps for migration tools)
RUN bun install --frozen-lockfile

# Copy source code and environment file
COPY . .

# Expose port
EXPOSE 3000

# Run the app
CMD ["bun", "run", "src/index.ts"]