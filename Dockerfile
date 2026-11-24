# syntax=docker/dockerfile:1
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production MAO_HOST=0.0.0.0 MAO_PORT=4317 MAO_DATA_DIR=/data MAO_WEB_DIST=/app/web/dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/web/dist ./web/dist
COPY package.json ./
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 4317
WORKDIR /app/server
USER node
CMD ["node", "dist/index.js"]
