module github.com/Elfo404/cicdo11y/collector

go 1.22.5

toolchain go1.22.2

replace github.com/Elfo404/ci-otel-collector/receiver/githubactionsreceiver => ./receiver/githubactionsreceiver

replace github.com/Elfo404/ci-otel-collector/internal/sharedcomponent => ./internal/sharedcomponent
