# ---- Build stage: install deps and build the static client ----
FROM node:20-alpine AS builder
WORKDIR /app

# Install all dependencies (workspaces: root + client)
COPY package.json ./
COPY client/package.json ./client/
COPY package-lock.json* bun.lock* ./
RUN if [ -f package-lock.json ]; then \
        npm ci --workspaces --include-workspace-root; \
    else \
        corepack enable && bun install --frozen-lockfile; \
    fi

COPY . .

# Build client (Vite) -> /app/dist/client
RUN npm run build

# ---- Runtime stage: nginx serving static files ----
FROM nginx:1.27-alpine AS runner

COPY nginx.conf /etc/nginx/conf.d/default.conf

# Static site (includes samples from client/public via Vite copy)
COPY --from=builder /app/dist/client /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
