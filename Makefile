.PHONY: prepare-test-fixtures
prepare-test-fixtures:
	cargo run -p everr-cli --bin warm_otlp_extension --release

.PHONY: test
test: prepare-test-fixtures
	cargo test --workspace
