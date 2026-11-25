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
# Tools the agents use for real work: ffmpeg/ffprobe, python + edge-tts (voice-over), git, and the Claude Code CLI.
RUN apt-get update  && apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 python3-pip python3-venv git curl  && rm -rf /var/lib/apt/lists/*  && pip3 install --no-cache-dir --break-system-packages edge-tts  && npm install -g --no-audit --no-fund @anthropic-ai/claude-code  && npm cache clean --force
WORKDIR /app
ENV NODE_ENV=production MAO_HOST=0.0.0.0 MAO_PORT=4317 MAO_DATA_DIR=/data MAO_WEB_DIST=/app/web/dist     MAO_TRUST_PROXY="loopback, uniquelocal"
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/web/dist ./web/dist
COPY package.json ./
RUN mkdir -p /data /home/node/.claude && chown -R node:node /data /home/node/.claude
VOLUME ["/data"]
EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:4317/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/server
USER node
CMD ["node", "dist/index.js"]
