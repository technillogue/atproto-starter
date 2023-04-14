FROM node:18-alpine AS pnpm
RUN apk add --no-cache libc6-compat curl
WORKDIR /app
RUN curl -f https://get.pnpm.io/v6.16.js | node - add --global pnpm
COPY ./package.json ./pnpm-lock.yaml /app/

FROM pnpm as deps
RUN pnpm install --prod; # we don't want dev deps in release

FROM pnpm as builder
RUN pnpm install # we need to install dev deps to build
COPY ./.swcrc /app/
# enumerate specifically to exclude .git etc 
COPY ./src /app/src
# rebuild the source code only when needed
RUN pnpm run build

# production image, copy all the files
FROM node:18-alpine AS runner
WORKDIR /app

 # prod only
COPY --from=deps /app/node_modules /app/node_modules/
COPY --from=builder /app/dist/index.js /app/
ENTRYPOINT ["/usr/local/bin/node", "/app/index.js"]
