# STAGE 1 - build
FROM golang:1.26.0-alpine AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/everr-cdevents ./

# STAGE 2 - final image
FROM alpine:3.23
RUN apk --no-cache add ca-certificates
RUN adduser -D -u 10001 cdevents

COPY --from=build /out/everr-cdevents /usr/bin/everr-cdevents

USER cdevents
EXPOSE 8082
ENTRYPOINT ["/usr/bin/everr-cdevents"]
