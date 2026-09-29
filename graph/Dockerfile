# Container Apps Job image: drains the graph_jobs queue (worker.ts).
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
CMD ["npx", "tsx", "worker.ts"]
