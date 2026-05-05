use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, bail};
use reqwest::Client;
use serde_json::{Value, json};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::cli::WrapArgs;

const BATCH_SIZE: usize = 64;
const READ_BUFFER_SIZE: usize = 8 * 1024;
const MAX_LOG_BODY_BYTES: usize = 16 * 1024;
const FLUSH_INTERVAL: Duration = Duration::from_millis(200);
const EXPORT_TIMEOUT: Duration = Duration::from_secs(5);
const EXPORT_DRAIN_TIMEOUT: Duration = Duration::from_secs(1);
const COLLECTOR_UNAVAILABLE: &str =
    "telemetry collector isn't running — run `everr local start` or open Everr Desktop";

pub async fn run(args: WrapArgs) -> Result<()> {
    let command = WrappedCommand::new(args.command)?;
    let exporter = OtlpLogExporter::new(command.clone());
    if exporter.probe().await.is_err() {
        eprintln!("{COLLECTOR_UNAVAILABLE}");
        std::process::exit(2);
    }

    let mut child = Command::new(&command.program)
        .args(&command.args)
        .stdin(Stdio::inherit())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("run wrapped command `{}`", command.display))?;

    let stdout = child.stdout.take().context("capture wrapped stdout")?;
    let stderr = child.stderr.take().context("capture wrapped stderr")?;
    let (records_tx, records_rx) = mpsc::channel(BATCH_SIZE * 4);
    let export_task = tokio::spawn(export_records(exporter, records_rx));

    let stdout_task = tokio::spawn(forward_stream(
        stdout,
        tokio::io::stdout(),
        "stdout",
        records_tx.clone(),
    ));
    let stderr_task = tokio::spawn(forward_stream(
        stderr,
        tokio::io::stderr(),
        "stderr",
        records_tx.clone(),
    ));

    let status = child.wait().await.context("wait for wrapped command")?;
    stdout_task
        .await
        .context("stdout forwarding task failed")??;
    stderr_task
        .await
        .context("stderr forwarding task failed")??;

    let exit_code = exit_code_for_status(&status);
    try_queue_record(&records_tx, LogRecord::exit(exit_code));
    drop(records_tx);

    match tokio::time::timeout(EXPORT_DRAIN_TIMEOUT, export_task).await {
        Ok(join_result) => {
            if let Err(err) = join_result.context("log export task failed")? {
                eprintln!("everr wrap: failed to send some logs to the local collector: {err}");
            }
        }
        Err(_) => {
            eprintln!("everr wrap: timed out sending some logs to the local collector");
        }
    }

    if status.success() {
        return Ok(());
    }

    std::process::exit(exit_code);
}

async fn forward_stream<R, W>(
    reader: R,
    mut writer: W,
    stream: &'static str,
    records_tx: mpsc::Sender<LogRecord>,
) -> Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut reader = reader;
    let mut buf = [0_u8; READ_BUFFER_SIZE];
    let mut recorder = StreamLogRecorder::new(stream, records_tx);

    loop {
        let read = reader
            .read(&mut buf)
            .await
            .with_context(|| format!("read wrapped {stream}"))?;
        if read == 0 {
            recorder.finish();
            return Ok(());
        }

        let chunk = &buf[..read];
        if let Err(err) = writer.write_all(chunk).await {
            if err.kind() == std::io::ErrorKind::BrokenPipe {
                return Ok(());
            }
            return Err(err).with_context(|| format!("write wrapped {stream}"));
        }
        if let Err(err) = writer.flush().await {
            if err.kind() == std::io::ErrorKind::BrokenPipe {
                return Ok(());
            }
            return Err(err).with_context(|| format!("flush wrapped {stream}"));
        }

        recorder.record(chunk);
    }
}

struct StreamLogRecorder {
    stream: &'static str,
    records_tx: mpsc::Sender<LogRecord>,
    pending: Vec<u8>,
}

impl StreamLogRecorder {
    fn new(stream: &'static str, records_tx: mpsc::Sender<LogRecord>) -> Self {
        Self {
            stream,
            records_tx,
            pending: Vec::new(),
        }
    }

    fn record(&mut self, bytes: &[u8]) {
        for part in bytes.split_inclusive(|byte| *byte == b'\n') {
            self.pending.extend_from_slice(part);
            if part.ends_with(b"\n") || self.pending.len() >= MAX_LOG_BODY_BYTES {
                self.flush();
            }
        }
    }

    fn finish(&mut self) {
        self.flush();
    }

    fn flush(&mut self) {
        if self.pending.is_empty() {
            return;
        }

        try_queue_record(
            &self.records_tx,
            LogRecord::line(self.stream, &self.pending),
        );
        self.pending.clear();
    }
}

fn try_queue_record(records_tx: &mpsc::Sender<LogRecord>, record: LogRecord) {
    let _ = records_tx.try_send(record);
}

async fn export_records(
    exporter: OtlpLogExporter,
    mut records_rx: mpsc::Receiver<LogRecord>,
) -> Result<()> {
    let mut batch = Vec::with_capacity(BATCH_SIZE);
    let mut ticker = tokio::time::interval(FLUSH_INTERVAL);
    let mut first_error = None;

    loop {
        tokio::select! {
            maybe_record = records_rx.recv() => {
                match maybe_record {
                    Some(record) => {
                        batch.push(record);
                        if batch.len() >= BATCH_SIZE {
                            flush_batch(&exporter, &mut batch, &mut first_error).await;
                        }
                    }
                    None => {
                        flush_batch(&exporter, &mut batch, &mut first_error).await;
                        return match first_error {
                            Some(err) => Err(err),
                            None => Ok(()),
                        };
                    }
                }
            }
            _ = ticker.tick() => {
                flush_batch(&exporter, &mut batch, &mut first_error).await;
            }
        }
    }
}

async fn flush_batch(
    exporter: &OtlpLogExporter,
    batch: &mut Vec<LogRecord>,
    first_error: &mut Option<anyhow::Error>,
) {
    if batch.is_empty() {
        return;
    }

    let records = std::mem::take(batch);
    if let Err(err) = exporter.send(&records).await {
        if first_error.is_none() {
            *first_error = Some(err);
        }
    }
}

#[derive(Clone, Debug)]
struct WrappedCommand {
    program: String,
    args: Vec<String>,
    display: String,
}

impl WrappedCommand {
    fn new(command: Vec<String>) -> Result<Self> {
        let mut parts = command.into_iter();
        let program = parts.next().context("provide a command to wrap")?;
        let args: Vec<String> = parts.collect();
        let display = std::iter::once(program.as_str())
            .chain(args.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" ");

        Ok(Self {
            program,
            args,
            display,
        })
    }

    fn service_name(&self) -> String {
        format!("everr-wrap-{}", self.program)
    }
}

#[derive(Clone)]
struct OtlpLogExporter {
    http: Client,
    endpoint: String,
    command: WrappedCommand,
}

impl OtlpLogExporter {
    fn new(command: WrappedCommand) -> Self {
        Self {
            http: Client::builder()
                .timeout(EXPORT_TIMEOUT)
                .build()
                .expect("reqwest client"),
            endpoint: format!("{}/v1/logs", everr_core::build::otlp_http_origin()),
            command,
        }
    }

    async fn probe(&self) -> Result<()> {
        self.post(json!({ "resourceLogs": [] })).await
    }

    async fn send(&self, records: &[LogRecord]) -> Result<()> {
        if records.is_empty() {
            return Ok(());
        }

        self.post(self.payload(records)).await
    }

    async fn post(&self, payload: Value) -> Result<()> {
        let response = self
            .http
            .post(&self.endpoint)
            .json(&payload)
            .send()
            .await
            .with_context(|| format!("POST {}", self.endpoint))?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }

        let body = response.text().await.unwrap_or_default();
        bail!("collector returned {status}: {body}");
    }

    fn payload(&self, records: &[LogRecord]) -> Value {
        json!({
            "resourceLogs": [{
                "resource": {
                    "attributes": [
                        attr("service.name", &self.command.service_name()),
                    ],
                },
                "scopeLogs": [{
                    "scope": {
                        "name": "everr-cli.wrap",
                    },
                    "logRecords": records.iter().map(|record| self.log_record(record)).collect::<Vec<_>>(),
                }],
            }],
        })
    }

    fn log_record(&self, record: &LogRecord) -> Value {
        let mut attrs = vec![
            attr("everr.wrap.stream", record.stream),
            attr("everr.wrap.command", &self.command.display),
            attr("everr.wrap.executable", &self.command.program),
        ];
        if let Some(exit_code) = record.exit_code {
            attrs.push(attr("everr.wrap.exit_code", &exit_code.to_string()));
        }

        json!({
            "timeUnixNano": record.time_unix_nano,
            "observedTimeUnixNano": record.time_unix_nano,
            "severityText": record.severity_text,
            "severityNumber": record.severity_number,
            "body": {
                "stringValue": record.body,
            },
            "attributes": attrs,
        })
    }
}

#[derive(Clone, Debug)]
struct LogRecord {
    time_unix_nano: String,
    stream: &'static str,
    severity_text: &'static str,
    severity_number: u8,
    body: String,
    exit_code: Option<i32>,
}

impl LogRecord {
    fn line(stream: &'static str, bytes: &[u8]) -> Self {
        let body = line_body(bytes);
        let (severity_text, severity_number) = match stream {
            "stderr" => ("ERROR", 17),
            _ => ("INFO", 9),
        };

        Self {
            time_unix_nano: time_unix_nano(),
            stream,
            severity_text,
            severity_number,
            body,
            exit_code: None,
        }
    }

    fn exit(exit_code: i32) -> Self {
        let (severity_text, severity_number) = if exit_code == 0 {
            ("INFO", 9)
        } else {
            ("ERROR", 17)
        };

        Self {
            time_unix_nano: time_unix_nano(),
            stream: "exit",
            severity_text,
            severity_number,
            body: format!("wrapped command exited with code {exit_code}"),
            exit_code: Some(exit_code),
        }
    }
}

fn attr(key: &str, value: &str) -> Value {
    json!({
        "key": key,
        "value": {
            "stringValue": value,
        },
    })
}

fn line_body(bytes: &[u8]) -> String {
    let bytes = bytes.strip_suffix(b"\n").unwrap_or(bytes);
    let bytes = bytes.strip_suffix(b"\r").unwrap_or(bytes);
    String::from_utf8_lossy(bytes).to_string()
}

fn time_unix_nano() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn exit_code_for_status(status: &std::process::ExitStatus) -> i32 {
    if let Some(code) = status.code() {
        return code;
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;

        if let Some(signal) = status.signal() {
            return 128 + signal;
        }
    }

    1
}
