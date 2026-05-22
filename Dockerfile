# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare yarn@1.22.21 --activate

COPY package.json yarn.lock tsconfig.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/core/package.json packages/core/
COPY packages/sdk-web/package.json packages/sdk-web/
COPY packages/sdk-miniprogram/package.json packages/sdk-miniprogram/
COPY packages/sdk-uniapp/package.json packages/sdk-uniapp/

RUN yarn install --frozen-lockfile

COPY . .
RUN yarn build

# Production stage
FROM node:20-alpine
WORKDIR /app

RUN corepack enable && corepack prepare yarn@1.22.21 --activate

ENV NODE_ENV=production
ENV PORT=3100

COPY package.json yarn.lock ./
COPY apps/server/package.json apps/server/
COPY packages/core/package.json packages/core/

RUN yarn install --frozen-lockfile --production && yarn cache clean

COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist

EXPOSE 3100

CMD ["node", "apps/server/dist/index.cjs"]
