FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}/bin:${PATH}"

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/bot/package.json ./packages/bot/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN ENV=/root/.shrc SHELL=/bin/sh npx --yes get-pnpm

RUN pnpm install --filter @yanqi/api... --prod --frozen-lockfile --ignore-scripts

COPY tsconfig.json ./
COPY packages/bot ./packages/bot
COPY apps/api ./apps/api

ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
EXPOSE 3100

CMD ["node", "apps/api/run.mjs"]
