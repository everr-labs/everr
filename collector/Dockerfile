# STAGE 1 - build
FROM golang:1.22.4-alpine3.20 as build
WORKDIR /src

COPY . .

RUN apk --update add --no-cache git make bash ca-certificates

RUN make build

# STAGE 2 - final image
FROM scratch

ARG BIN_PATH=/src/build/ci-otelcol

ARG UID=10001
USER ${UID}

COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build --chmod=755 ${BIN_PATH} /usr/bin/ci-otelcol

ENTRYPOINT ["/usr/bin/ci-otelcol"] 
CMD ["--config=/etc/ci-otelcol/config.yaml"]