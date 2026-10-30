FROM node:24-bookworm-slim AS web
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:24-bookworm-slim AS api-dependencies
WORKDIR /build/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY --from=api-dependencies /build/backend/node_modules ./node_modules
COPY backend/package*.json ./
COPY backend/src ./src
COPY --from=web /build/frontend/dist /app/frontend/dist
RUN mkdir -p /app/backend/data && chown -R node:node /app
USER node
ENV HOST=0.0.0.0 PORT=8000 FRONTEND_DIRECTORY=/app/frontend/dist FFMPEG_PATH=/usr/bin/ffmpeg
EXPOSE 8000
CMD ["node", "src/server.js"]
