FROM node:20-alpine AS base
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# --- Builder ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Runner ---
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy full app (standalone needs some extras for knex migrations)
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/database ./database
COPY --from=builder /app/knexfile.ts ./knexfile.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/types ./types
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh

RUN mkdir -p /app/uploads && chown -R nextjs:nodejs /app/uploads /app/.next
RUN chmod +x /app/docker-entrypoint.sh

USER nextjs

EXPOSE 3002

ENV PORT=3002
ENV HOSTNAME="0.0.0.0"
ENV UPLOAD_DIR=/app/uploads

ENTRYPOINT ["./docker-entrypoint.sh"]
