import { logs } from "@opentelemetry/api-logs";
import { LoggerProvider, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";

class StdoutExporter {
  export(records, resultCallback) {
    for (const record of records) {
      process.stdout.write(
        `${JSON.stringify({
          body: record.body,
          severityNumber: record.severityNumber,
          mechanism: record.attributes["exception.mechanism"],
        })}\n`,
      );
    }
    resultCallback({ code: 0 });
  }

  shutdown() {
    return Promise.resolve();
  }
}

export function installStdoutTelemetry() {
  const provider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor(new StdoutExporter())],
  });
  logs.setGlobalLoggerProvider(provider);
}
