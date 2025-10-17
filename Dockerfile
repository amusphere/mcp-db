FROM node:20-slim

WORKDIR /app

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files AND tsconfig.json before npm ci
COPY package.json package-lock.json tsconfig.json ./

# Copy source files needed for prepare script
COPY src ./src

# Install dependencies (runs prepare script which needs tsconfig.json and src/)
RUN npm ci

# Copy remaining files
COPY tests ./tests
COPY mcp.json openapi.yaml README.md .env.example ./

# Only prune dev dependencies in production
RUN if [ "$NODE_ENV" = "production" ]; then npm prune --omit=dev; fi

ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "dist/index.js"]
