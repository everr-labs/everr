module github.com/everr-labs/everr/collector/internal/localgateway/sqlhttp

go 1.26.11

require (
	github.com/everr-labs/everr/collector/internal/localgateway/chdb v0.0.0-00010101000000-000000000000
	go.uber.org/zap v1.28.0
)

require (
	github.com/ebitengine/purego v0.10.2 // indirect
	go.uber.org/multierr v1.10.0 // indirect
)

replace github.com/everr-labs/everr/collector/internal/localgateway/chdb => ../chdb
