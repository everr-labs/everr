module github.com/Elfo404/cicdo11y/collector

go 1.23.2

replace github.com/Elfo404/ci-otel-collector/receiver/githubactionsreceiver => ./receiver/githubactionsreceiver

replace github.com/Elfo404/ci-otel-collector/internal/sharedcomponent => ./internal/sharedcomponent
