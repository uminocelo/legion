FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN npm install -g pnpm@10.34.9
WORKDIR /app

# ---- build: all deps + TypeScript ----
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY packages/core/package.json packages/core/
COPY packages/bot-cerebro/package.json packages/bot-cerebro/
COPY packages/bot-jarvis/package.json packages/bot-jarvis/
COPY packages/bot-herbie/package.json packages/bot-herbie/
COPY packages/bot-sentinel/package.json packages/bot-sentinel/
COPY packages/bot-ultron/package.json packages/bot-ultron/
COPY apps/runner/package.json apps/runner/
COPY apps/cli/package.json apps/cli/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps
RUN pnpm build

# ---- runtime: production deps + compiled output only ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=build /app/packages/core/package.json packages/core/
COPY --from=build /app/packages/bot-cerebro/package.json packages/bot-cerebro/
COPY --from=build /app/packages/bot-jarvis/package.json packages/bot-jarvis/
COPY --from=build /app/packages/bot-herbie/package.json packages/bot-herbie/
COPY --from=build /app/packages/bot-sentinel/package.json packages/bot-sentinel/
COPY --from=build /app/packages/bot-ultron/package.json packages/bot-ultron/
COPY --from=build /app/apps/runner/package.json apps/runner/
COPY --from=build /app/apps/cli/package.json apps/cli/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/core/data packages/core/data
COPY --from=build /app/packages/core/locales packages/core/locales
COPY --from=build /app/packages/core/drizzle packages/core/drizzle
COPY --from=build /app/packages/bot-cerebro/dist packages/bot-cerebro/dist
COPY --from=build /app/packages/bot-cerebro/locales packages/bot-cerebro/locales
COPY --from=build /app/packages/bot-cerebro/drizzle packages/bot-cerebro/drizzle
COPY --from=build /app/packages/bot-jarvis/dist packages/bot-jarvis/dist
COPY --from=build /app/packages/bot-jarvis/locales packages/bot-jarvis/locales
COPY --from=build /app/packages/bot-jarvis/drizzle packages/bot-jarvis/drizzle
COPY --from=build /app/packages/bot-jarvis/content packages/bot-jarvis/content
COPY --from=build /app/packages/bot-herbie/dist packages/bot-herbie/dist
COPY --from=build /app/packages/bot-herbie/locales packages/bot-herbie/locales
COPY --from=build /app/packages/bot-herbie/drizzle packages/bot-herbie/drizzle
COPY --from=build /app/packages/bot-herbie/content packages/bot-herbie/content
COPY --from=build /app/packages/bot-sentinel/dist packages/bot-sentinel/dist
COPY --from=build /app/packages/bot-sentinel/locales packages/bot-sentinel/locales
COPY --from=build /app/packages/bot-sentinel/drizzle packages/bot-sentinel/drizzle
COPY --from=build /app/packages/bot-ultron/drizzle packages/bot-ultron/drizzle
COPY --from=build /app/packages/bot-ultron/dist packages/bot-ultron/dist
COPY --from=build /app/packages/bot-ultron/locales packages/bot-ultron/locales
COPY --from=build /app/packages/bot-ultron/content packages/bot-ultron/content
COPY --from=build /app/apps/runner/dist apps/runner/dist
COPY --from=build /app/apps/cli/dist apps/cli/dist
RUN ln -s /app/apps/cli/dist/index.js /usr/local/bin/legion && chmod +x apps/cli/dist/index.js \
  && mkdir -p /app/data /app/locales && chown node:node /app/data

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Starts as root to fix ./data ownership on fresh bind mounts, then runs as "node".
# Mounted by docker-compose: ./data → /app/data, legion.config.yaml and locales/ (overrides).
ENV DATABASE_URL=file:./data/legion.db HEALTH_PORT=8080 LEGION_CONFIG=/app/legion.config.yaml
VOLUME ["/app/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
STOPSIGNAL SIGTERM
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--enable-source-maps", "/app/apps/runner/dist/main.js"]
