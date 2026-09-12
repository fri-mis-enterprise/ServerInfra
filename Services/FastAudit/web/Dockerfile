FROM oven/bun:1.4-slim
WORKDIR /app
COPY package.json server.ts views.ts styles.css ./
EXPOSE 3000
CMD ["bun", "run", "server.ts"]
