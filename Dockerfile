# Production image: Next.js standalone server (~ small runtime, no dev dependencies).
#   docker build -t case-manager .
#   docker run -p 3000:3000 -e APP_SECRET=... -e DATABASE_URL=... -v case-data:/var/data case-manager

# ---- 1. Install dependencies ----
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- 2. Build ----
FROM node:22-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Inlined into the client bundle at build time.
ARG NEXT_PUBLIC_TIME_ZONE=Asia/Jerusalem
ENV NEXT_PUBLIC_TIME_ZONE=$NEXT_PUBLIC_TIME_ZONE
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- 3. Runtime ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    DATA_DIR=/var/data \
    STORAGE_DIR=/var/data/uploads \
    PGLITE_DIR=/var/data/pglite
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY docker/start.cjs ./start.cjs
RUN mkdir -p /var/data && chown -R node:node /app /var/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "start.cjs"]
