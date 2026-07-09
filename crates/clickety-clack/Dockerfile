# Multi-stage build for the `cc` binary (all roles in one image; role selected
# at runtime via CC_ROLE). Used by everr's docker-compose to run clickety-clack
# alongside the everr dev stack.
FROM rust:1-bookworm AS builder
WORKDIR /build
COPY . .
RUN cargo build --release --bin cc

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/target/release/cc /usr/local/bin/cc
# Defaults; compose overrides the connection vars. CC runs its own Postgres
# migrations on boot.
ENV CC_ROLE=all \
    CC_HTTP_ADDR=0.0.0.0:8080
EXPOSE 8080
ENTRYPOINT ["cc"]
