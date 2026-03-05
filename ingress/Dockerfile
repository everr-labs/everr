# STAGE 1 - build
FROM golang:1.26.0-alpine AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/everr-ingress ./

# STAGE 2 - final image
FROM alpine:3.23
RUN apk --no-cache add ca-certificates
RUN adduser -D -u 10001 ingress

COPY --from=build /out/everr-ingress /usr/bin/everr-ingress

USER ingress
EXPOSE 8081
ENTRYPOINT ["/usr/bin/everr-ingress"]
