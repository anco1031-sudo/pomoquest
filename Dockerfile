# ---- Stage 1: Build frontend + native modules ----
FROM node:22-slim AS builder

WORKDIR /app

# Install build tools for better-sqlite3 native compilation
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Stage 2: Production (copy compiled node_modules) ----
FROM node:22-slim

WORKDIR /app

# Copy everything from builder (includes compiled native modules)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Copy server source
COPY server ./server

# Create data directory for SQLite
RUN mkdir -p /app/server/data

EXPOSE 3001

CMD ["node", "server/index.js"]
