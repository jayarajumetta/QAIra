FROM node:20-alpine

WORKDIR /app

COPY api/package*.json ./
RUN npm ci --no-audit --no-fund

COPY api/src ./src

EXPOSE 3000

CMD ["node", "src/server.js"]
