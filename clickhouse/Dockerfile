FROM clickhouse/clickhouse-server:26.5 AS base
COPY init/cloud/ /docker-entrypoint-initdb.d/

FROM base AS self-hosted
COPY --chmod=755 self-hosted/99-configure-access.sh /docker-entrypoint-initdb.d/

FROM base AS cloud
