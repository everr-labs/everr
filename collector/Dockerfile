# STAGE 1 - build
FROM golang:1.26.0-alpine AS build
WORKDIR /collector

COPY . .

RUN apk --update add --no-cache git make bash ca-certificates

RUN make build
RUN rm -rf /tmp-empty && mkdir /tmp-empty

# STAGE 2 - final image
FROM scratch

ARG BIN_PATH=/collector/build/citric-collector

ARG UID=10001
USER ${UID}

COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build --chmod=1777 /tmp-empty /tmp
COPY --from=build --chmod=755 ${BIN_PATH} /usr/bin/citric-collector

ENTRYPOINT ["/usr/bin/citric-collector"]
CMD ["--config=/etc/citric-collector/config.yaml"]
