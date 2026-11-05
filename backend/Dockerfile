# Use Node.js LTS image
FROM node:20-slim

# Install yt-dlp and dependencies (including OpenSSL for Prisma)
RUN apt-get update && apt-get install -y \
  python3 \
  curl \
  ffmpeg \
  openssl \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove devDependencies after build
RUN npm prune --production

# Expose port (Railway will use PORT env var)
EXPOSE 8787

# Run migrations and start the server
# - prisma migrate deploy: applies pending migrations (safe for production, no prompts)
# - node dist/server.js: starts the backend
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
