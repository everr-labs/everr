# STAGE 1 - build
FROM golang:1.23.2-alpine3.20 AS build
WORKDIR /collector

COPY . .

RUN apk --update add --no-cache git make bash ca-certificates

RUN make build

# STAGE 2 - final image
FROM scratch

ARG BIN_PATH=/collector/build/ci-otelcol

ARG UID=10001
USER ${UID}

COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build --chmod=755 ${BIN_PATH} /usr/bin/ci-otelcol

ENTRYPOINT ["/usr/bin/ci-otelcol"] 
CMD ["--config=/etc/ci-otelcol/config.yaml"]