FROM node:22-slim AS base

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Build TypeScript
FROM base AS build
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Production image
FROM node:22-slim
WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY public/ ./public/

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/server.js"]
