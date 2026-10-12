FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}/bin:${PATH}"

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN ENV=/root/.shrc SHELL=/bin/sh npx --yes get-pnpm

RUN pnpm install --prod --frozen-lockfile --ignore-scripts

COPY tsconfig.json PERSONA.md run.mjs ./
COPY src ./src
COPY skills ./skills

ENV NODE_ENV=production

CMD ["node", "run.mjs"]
