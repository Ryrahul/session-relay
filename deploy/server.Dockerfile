FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci --workspace @session-relay/shared --workspace @session-relay/server --workspace @session-relay/web --include-workspace-root
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/web packages/web
RUN npm run build -w @session-relay/shared \
 && npm run build -w @session-relay/server \
 && npm run build -w @session-relay/web \
 && npm prune --omit=dev --workspace @session-relay/shared --workspace @session-relay/server --include-workspace-root

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV WEB_DIST=/app/web
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/server/package.json packages/server/
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/server/migrations packages/server/migrations
COPY --from=build /app/packages/web/dist web
RUN mkdir -p /data/transcripts && chown node:node /data/transcripts
USER node
EXPOSE 8787
CMD ["node", "packages/server/dist/index.js"]
