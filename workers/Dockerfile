FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
COPY workers/package.json workers/pnpm-lock.yaml ./workers/

RUN pnpm install --prod --frozen-lockfile
RUN cd workers && pnpm install --prod --frozen-lockfile

COPY lib ./lib
COPY workers ./workers

CMD ["node", "--experimental-strip-types", "workers/index.ts"]
