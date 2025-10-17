FROM node:20-slim

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src
COPY mcp.json openapi.yaml README.md .env.example ./

RUN npm run build

EXPOSE 8080

CMD ["node", "dist/index.js"]
