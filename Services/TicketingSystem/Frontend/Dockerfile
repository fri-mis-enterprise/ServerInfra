# Stage 1: Build
FROM oven/bun:1.4.4 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy the rest of the frontend files
COPY . .

# Build the application
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=$VITE_BASE_PATH
ARG FRONTEND_URL
ENV FRONTEND_URL=$FRONTEND_URL

RUN bun run build

# Stage 2: Serve
FROM oven/bun:1.4.4
WORKDIR /app

# Copy the SvelteKit Bun server and runtime dependencies
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src/lib/server/db ./src/lib/server/db

ENV PORT=3000

EXPOSE 3000

CMD ["sh", "-c", "bun build/migrate.js && exec bun build/index.js"]
