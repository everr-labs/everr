FROM clickhouse/clickhouse-server:26.8.34.13 AS base
COPY init/shared/ /docker-entrypoint-initdb.d/

FROM base AS self-hosted
COPY init/self-hosted/ /docker-entrypoint-initdb.d/

FROM base AS cloud
COPY init/cloud/ /docker-entrypoint-initdb.d/
