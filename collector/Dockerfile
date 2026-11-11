# STAGE 1 - build
FROM golang:1.26.11-alpine3.24 AS build
WORKDIR /collector

ARG EVERR_BUILD_TARGET=cloud

COPY . .

RUN apk --update add --no-cache git make bash ca-certificates

RUN make build EVERR_BUILD_TARGET=${EVERR_BUILD_TARGET}

# The final image has no shell or wget for container healthchecks.
RUN cd cmd/healthcheck && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/everr-healthcheck .

# Distroless has no mkdir, so the queue directory is made here. A new named
# volume mounted on it takes its owner.
RUN mkdir -p /out/queue

# STAGE 2 - final image
FROM gcr.io/distroless/static-debian13:nonroot

ARG EVERR_BUILD_TARGET=cloud
ARG BIN_PATH=/collector/build/${EVERR_BUILD_TARGET}/everr-collector
# Volumes created by earlier images are owned by this UID.
ARG UID=10001

COPY --from=build --chown=${UID}:${UID} /out/queue /var/lib/everr/queue
COPY --from=build --chmod=755 ${BIN_PATH} /usr/bin/everr-collector
COPY --from=build --chmod=755 /out/everr-healthcheck /usr/bin/everr-healthcheck

USER ${UID}:${UID}

ENTRYPOINT ["/usr/bin/everr-collector"]
CMD ["--config=/etc/everr-collector/config.yaml"]
