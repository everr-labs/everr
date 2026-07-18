# Multi-stage build for the `cc` binary (all roles in one image; role selected
# at runtime via CC_ROLE). Used by everr's docker-compose to run clickety-clack
# alongside the everr dev stack.
FROM rust:1-bookworm AS builder
# Cargo profile to build with. The everr dev compose passes `dev` (unoptimized,
# much faster to compile); anything shipping the image keeps the default.
ARG PROFILE=release
WORKDIR /build
COPY . .
# The `dev` profile writes to target/debug; other profiles use their own name.
RUN cargo build --profile "$PROFILE" --bin cc \
  && cp "target/$([ "$PROFILE" = dev ] && echo debug || echo "$PROFILE")/cc" /build/cc-bin

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/cc-bin /usr/local/bin/cc
# Defaults; compose overrides the connection vars. CC runs its own Postgres
# migrations on boot.
ENV CC_ROLE=all \
    CC_HTTP_ADDR=0.0.0.0:8080
EXPOSE 8080
ENTRYPOINT ["cc"]
