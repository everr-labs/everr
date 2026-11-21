# Error fingerprint processor

`everr_fingerprint` stamps `everr.error.fingerprint` on every exception log:
a log with a `service.name` resource attribute, `SeverityNumber >= 17`, and an
`exception.type` or `exception.message` attribute. The Errors views group by
it, so queries no longer hash every row.

The value is the application's `error.fingerprint` attribute when set, else a
hash of the service, the exception type, and the exception message with UUIDs,
long ids, hex values, and long quoted strings collapsed.

It equals what the `errorFingerprint` ClickHouse UDF returns for the same log,
so logs stored before the processor ran (grouped by the UDF) and logs stamped
by it form one Error. `testdata/fingerprints.json` holds UDF outputs: this
module's tests check the Go hash against it, and the chdbexporter tests check
the UDF against it.

A client-sent `everr.error.fingerprint` is always removed or overwritten.

In metered pipelines it goes after `everr_usage`, so customers are not billed
for the attribute. The usage extension allows it there because it hands every
batch on synchronously, drops nothing, and returns the exporter's error.

```yaml
processors:
  everr_fingerprint: {}
```
