use assert_cmd::Command;

#[test]
#[cfg(debug_assertions)]
fn command_export_ignores_customer_otlp_configuration() {
    let mut internal = mockito::Server::new();
    let mut customer = mockito::Server::new();
    let unexpected = customer
        .mock("POST", mockito::Matcher::Any)
        .expect(0)
        .create();
    let traces = internal
        .mock("POST", "/v1/traces")
        .match_header("content-type", "application/x-protobuf")
        .match_header("authorization", mockito::Matcher::Missing)
        .match_header("x-customer", mockito::Matcher::Missing)
        .with_status(200)
        .expect(1)
        .create();
    let logs = internal
        .mock("POST", "/v1/logs")
        .match_header("content-type", "application/x-protobuf")
        .match_header("authorization", mockito::Matcher::Missing)
        .match_header("x-customer", mockito::Matcher::Missing)
        .with_status(200)
        .expect_at_least(2)
        .create();
    let directory = tempfile::tempdir().unwrap();
    let mut command = Command::new(assert_cmd::cargo::cargo_bin!("everr"));
    command
        .current_dir(directory.path())
        .env("EVERR_INTERNAL_TELEMETRY_ENDPOINT", internal.url())
        .env("EVERR_INGEST_KEY", "customer-key")
        .env("OTEL_EXPORTER_OTLP_ENDPOINT", customer.url())
        .env(
            "OTEL_EXPORTER_OTLP_HEADERS",
            "Authorization=Bearer customer-key,x-customer=secret",
        )
        .env("OTEL_EXPORTER_OTLP_COMPRESSION", "gzip")
        .env("OTEL_EXPORTER_OTLP_PROTOCOL", "grpc")
        .env("OTEL_EXPORTER_OTLP_TIMEOUT", "0");
    for signal in ["TRACES", "LOGS"] {
        command
            .env(
                format!("OTEL_EXPORTER_OTLP_{signal}_ENDPOINT"),
                customer.url(),
            )
            .env(
                format!("OTEL_EXPORTER_OTLP_{signal}_HEADERS"),
                "Authorization=Bearer customer-key,x-customer=secret",
            )
            .env(
                format!("OTEL_EXPORTER_OTLP_{signal}_COMPRESSION"),
                "unsupported",
            )
            .env(format!("OTEL_EXPORTER_OTLP_{signal}_PROTOCOL"), "grpc")
            .env(format!("OTEL_EXPORTER_OTLP_{signal}_TIMEOUT"), "0");
    }
    command
        .args(["skills", "list", "--project"])
        .assert()
        .success();
    traces.assert();
    logs.assert();
    unexpected.assert();
}
