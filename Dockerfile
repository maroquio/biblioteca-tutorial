FROM oven/bun:1-slim

WORKDIR /app/backend

# primeiro só as dependências: enquanto package.json e bun.lock não mudarem,
# o Docker reaproveita esta camada e o build fica rápido
COPY backend/package.json backend/bun.lock ./
RUN bun install --frozen-lockfile --production

COPY backend/ ./

ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "src/main.ts"]
