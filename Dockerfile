FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}/bin:${PATH}"

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/bot/package.json ./packages/bot/package.json

RUN ENV=/root/.shrc SHELL=/bin/sh npx --yes get-pnpm

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.json nuxt.config.ts ./
COPY packages/bot ./packages/bot
COPY app ./app
COPY server ./server

RUN pnpm build

FROM node:24-bookworm-slim

WORKDIR /app
COPY --from=build /app/.output ./

ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=3000
EXPOSE 3000

CMD ["node", "server/index.mjs"]
