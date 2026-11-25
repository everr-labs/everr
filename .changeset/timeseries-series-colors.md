---
"@everr/app": minor
"@everr/app-cloud": patch
---

TimeSeriesChart panels accept a `colors` map that pins a series to a fixed hex color by name, the same option BarChart and StatChart already have. Series it doesn't name keep their palette color. The Telemetry Usage dashboard uses it so each signal has the same color in "Usage by signal" and "Ingestion volume by signal".
