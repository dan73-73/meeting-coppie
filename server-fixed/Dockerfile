FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.mjs relay.mjs ./
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node","server.mjs"]
