# Image of the core application. Build from the repository root:
#   docker build -f apps/core-api/Dockerfile --build-arg GIT_SHA=<commit> -t minesup/core-api:<commit> .
# Node 22.18 and later runs TypeScript directly, so there is no build step. The libraries are installed
# from the lock file (npm ci), so the image holds exactly the versions that the checks and tests ran with.
FROM node:22.23.4-alpine

ARG GIT_SHA=unknown
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    APP_VERSION=${GIT_SHA}

WORKDIR /app

# The libraries first, so that this layer is rebuilt only when a manifest or the lock file changes.
# Every workspace manifest is copied because the lock file describes all of them.
COPY package.json package-lock.json .npmrc ./
COPY apps/core-api/package.json apps/core-api/package.json
COPY apps/portal-api/package.json apps/portal-api/package.json
COPY apps/staff-web/package.json apps/staff-web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --omit=dev --workspace apps/core-api

COPY packages/contracts/src packages/contracts/src
COPY apps/core-api/src apps/core-api/src
# The database migration runner, so that a deployment can migrate the database from the image it is
# about to start (infra/staging/compose.yaml, service "migrate"). Only the runner and the one helper it
# imports are copied, never the rest of tools/.
COPY tools/db tools/db
COPY tools/lib/files.ts tools/lib/files.ts

# The image runs as the unprivileged user that the base image provides. SMS_ENV and the database
# settings are given when the container starts (infra/staging/compose.yaml), never baked in here.
USER node
EXPOSE 3000
CMD ["node", "apps/core-api/src/main.ts"]
