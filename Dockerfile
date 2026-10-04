# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3001 DB_PATH=/app/data/77erp.sqlite
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force \
    && mkdir -p /app/data && chown node:node /app/data
COPY server ./server
COPY docs/design-system.md ./docs/design-system.md
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3001
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/auth/status').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/index.js"]
