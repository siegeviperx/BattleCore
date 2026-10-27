# Game server for Fly.io. Build from the repo root: the server imports ../shared/protocol.ts.
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY shared ./shared
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/src ./server/src
WORKDIR /app/server
ENV PORT=8787
EXPOSE 8787
CMD ["node", "src/index.ts"]
