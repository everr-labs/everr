FROM clickhouse/clickhouse-server:26.5
ARG EVERR_BUILD_TARGET=cloud
COPY init/ /docker-entrypoint-initdb.d/
COPY ${EVERR_BUILD_TARGET}/ /docker-entrypoint-initdb.d/
RUN chmod +x /docker-entrypoint-initdb.d/*.sh
