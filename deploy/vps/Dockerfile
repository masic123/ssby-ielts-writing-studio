FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8788 DATABASE_PATH=/app/storage/writing.sqlite ASSET_DIRECTORY=/app/out
COPY server.mjs ./server.mjs
COPY out ./out
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 8788
CMD ["node", "server.mjs"]
