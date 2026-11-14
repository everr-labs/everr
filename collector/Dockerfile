# STAGE 1 - build
FROM golang:1.26.11-alpine3.24@sha256:ae52b5bc6ed045a9ed26ab03dc19327a802a9cc9aa8b27ed57f5c6b60579b0bb AS build
WORKDIR /collector

ARG EVERR_BUILD_TARGET=cloud

COPY . .

RUN apk --update add --no-cache git make bash ca-certificates

RUN make build EVERR_BUILD_TARGET=${EVERR_BUILD_TARGET}

# Distroless has no mkdir, so the queue directory is made here. A new named
# volume mounted on it takes its owner.
RUN mkdir -p /out/queue

# STAGE 2 - final image
FROM gcr.io/distroless/static-debian13:nonroot@sha256:25ac8f0c3b2334a9eb05452266bd4697864a8c8ef0ef71e5e6480d7f92868329

ARG EVERR_BUILD_TARGET=cloud
ARG BIN_PATH=/collector/build/${EVERR_BUILD_TARGET}/everr-collector
# Volumes created by earlier images are owned by this UID.
ARG UID=10001

COPY --from=build --chown=${UID}:${UID} /out/queue /var/lib/everr/queue
COPY --from=build --chmod=755 ${BIN_PATH} /usr/bin/everr-collector

USER ${UID}:${UID}

# Profiles are an alpha OTLP signal and need this gate. It sits in the
# entrypoint, not CMD, so a deployment that overrides the args keeps it. One
# that overrides the command (everr-deploy's collector.tf) must pass it too.
ENTRYPOINT ["/usr/bin/everr-collector", "--feature-gates=service.profilesSupport"]
CMD ["--config=/etc/everr-collector/config.yaml"]
