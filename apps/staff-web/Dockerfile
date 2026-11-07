# Image of the staff front end. Build from the repository root:
#   docker build -f apps/staff-web/Dockerfile -t minesup/staff-web:<commit> .
# Stage one builds the static files. Stage two holds only those files and a small web server; there is
# no Node and no package manager in the final image. The reverse proxy (infra/staging/Caddyfile) sends
# every address that is not an API address to this container.
FROM node:22.23.4-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/core-api/package.json apps/core-api/package.json
COPY apps/portal-api/package.json apps/portal-api/package.json
COPY apps/staff-web/package.json apps/staff-web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --workspace apps/staff-web
# The shared compiler settings, which the tsconfig of the application extends.
COPY tsconfig.base.json ./
COPY packages/contracts/src packages/contracts/src
COPY apps/staff-web apps/staff-web
RUN npm run build --workspace @minesup/staff-web

FROM caddy:2.10.0-alpine
COPY apps/staff-web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/staff-web/dist /srv
# Caddy writes a little state under /config and /data even with HTTPS off. Give them to the unprivileged
# user so that the container also starts cleanly outside compose (compose mounts temporary folders there).
RUN mkdir -p /config/caddy /data/caddy && chown -R nobody:nobody /config /data
USER nobody
EXPOSE 8080
