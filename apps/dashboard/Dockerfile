# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare yarn@1.22.21 --activate

COPY package.json yarn.lock tsconfig.json tsconfig.base.json ./
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/core/package.json packages/core/

RUN yarn install --frozen-lockfile

COPY . .
RUN yarn workspace @healthguard/dashboard build

# Production stage
FROM nginx:alpine
COPY --from=builder /app/apps/dashboard/dist /usr/share/nginx/html
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
