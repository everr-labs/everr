FROM node:24-alpine AS schema
ARG EVERR_BUILD_TARGET=cloud
WORKDIR /schema
COPY . .
RUN node render.mjs "$EVERR_BUILD_TARGET" /init

FROM clickhouse/clickhouse-server:26.5
COPY --from=schema /init/ /docker-entrypoint-initdb.d/
