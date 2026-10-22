FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
RUN npm ci --workspace @session-relay/shared --workspace @session-relay/server --include-workspace-root
COPY packages/shared packages/shared
COPY packages/server packages/server
RUN npm run build -w @session-relay/shared && npm run build -w @session-relay/server \
 && npm prune --omit=dev --workspace @session-relay/shared --workspace @session-relay/server --include-workspace-root

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/server/package.json packages/server/
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/server/migrations packages/server/migrations
USER node
EXPOSE 8787
CMD ["node", "packages/server/dist/index.js"]
