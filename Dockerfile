# Build context = repo root. Multi-stage build for the pnpm workspace
# (plan-11 §4). Final image runs apps/web via server.production.mjs.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/redis/package.json packages/redis/
COPY packages/storage/package.json packages/storage/
COPY packages/email/package.json packages/email/
COPY packages/auth/package.json packages/auth/
COPY packages/ai/package.json packages/ai/
RUN pnpm fetch

# Full install + build. Also the image of the one-shot `migrate` service in
# docker-compose.prod.yml (migrations + seed need devDependencies like tsx).
FROM deps AS build
COPY . .
RUN pnpm install --frozen-lockfile --offline && pnpm build

# Drop devDependencies; keep production deps + workspace links for runtime
FROM build AS prod-deps
RUN pnpm install --prod --frozen-lockfile --offline

FROM node:22-alpine AS runtime
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=prod-deps --chown=app:app /repo/package.json ./package.json
COPY --from=prod-deps --chown=app:app /repo/node_modules ./node_modules
COPY --from=prod-deps --chown=app:app /repo/packages ./packages
COPY --from=prod-deps --chown=app:app /repo/apps/web/dist ./apps/web/dist
COPY --from=prod-deps --chown=app:app /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=prod-deps --chown=app:app /repo/apps/web/server.production.mjs ./apps/web/server.production.mjs
USER app
EXPOSE 3000
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/apps/web
CMD ["node", "server.production.mjs"]
