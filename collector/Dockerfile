# STAGE 1 - build
FROM golang:1.26.0-alpine AS build
WORKDIR /collector

COPY . .

RUN apk --update add --no-cache git make bash ca-certificates

RUN make build

# STAGE 2 - final image
FROM alpine:3.23

ARG BIN_PATH=/collector/build/citric-collector
ARG UID=10001

RUN adduser -D -u ${UID} collector
COPY --from=build --chmod=755 ${BIN_PATH} /usr/bin/citric-collector

USER collector

ENTRYPOINT ["/usr/bin/citric-collector"]
CMD ["--config=/etc/citric-collector/config.yaml"]
