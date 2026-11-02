# Image of the core application. Build from the repository root:
#   docker build -f apps/core-api/Dockerfile --build-arg GIT_SHA=<commit> -t minesup/core-api:<commit> .
# Node 22.18 and later runs TypeScript directly, so there is no build step and, for now, no
# dependency to install.
FROM node:25.9.0-alpine

ARG GIT_SHA=unknown
ENV NODE_ENV=production \
    APP_VERSION=${GIT_SHA}

WORKDIR /app
COPY apps/core-api/package.json ./package.json
COPY apps/core-api/src ./src

# The image runs as the unprivileged user that the base image provides.
USER node
EXPOSE 3000
CMD ["node", "src/main.ts"]
