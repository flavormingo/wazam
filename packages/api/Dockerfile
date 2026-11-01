FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/

RUN pnpm install --frozen-lockfile --prod=false

COPY packages/shared/ packages/shared/
COPY packages/api/ packages/api/
COPY tsconfig.json ./

RUN pnpm --filter @wazam/shared build
RUN pnpm --filter @wazam/api build

FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

COPY --from=base /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=base /app/packages/shared/package.json packages/shared/
COPY --from=base /app/packages/api/package.json packages/api/

RUN pnpm install --frozen-lockfile --prod

COPY --from=base /app/packages/shared/dist packages/shared/dist
COPY --from=base /app/packages/api/dist packages/api/dist

EXPOSE 3000
CMD ["sh", "-c", "node packages/api/dist/db/migrate.js && node packages/api/dist/index.js"]
