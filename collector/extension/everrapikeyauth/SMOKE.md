# Manual smoke test for the public OTLP ingest pipeline

This walks the end-to-end auth + tenant-stamping flow against a real
collector binary.

## Steps

1. **Mint an ingest key** in the dashboard at `/_authenticated/_dashboard/ingest-keys`.
   Copy the key when shown — it is only revealed once.

2. **Run the collector** with the public OTLP pipeline:

   ```sh
   INGEST_VERIFY_URL=http://localhost:3000/api/internal/verify-key \
   INGEST_VERIFY_SHARED_SECRET=<32-char-or-longer-secret> \
   ./build/everr-collector --config ./config.yml
   ```

   Confirm the logs show `everr_apikey` extension started and the
   `otlp/public` receiver listening on `:4317` / `:4318`.

3. **Reject unauthenticated**: send an OTLP HTTP request without a key.

   ```sh
   curl -i -X POST http://localhost:4318/v1/traces \
     -H 'content-type: application/json' \
     -d '{"resourceSpans":[]}'
   ```

   Expect HTTP 401.

4. **Reject bad key**:

   ```sh
   curl -i -X POST http://localhost:4318/v1/traces \
     -H 'content-type: application/json' \
     -H 'authorization: Bearer ek_definitelynotreal' \
     -d '{"resourceSpans":[]}'
   ```

   Expect HTTP 401.

5. **Accept valid key + verify tenant overwrite.** Use `telemetrygen`:

   ```sh
   telemetrygen traces \
     --otlp-endpoint localhost:4317 \
     --otlp-insecure \
     --otlp-header authorization=\"Bearer $EVERR_INGEST_KEY\" \
     --otlp-attributes 'everr.tenant.id="org_evil"' \
     --duration 2s
   ```

   Confirm in the collector debug exporter that the resource attribute
   `everr.tenant.id` matches the **tenant the key belongs to**, not the
   `org_evil` value supplied by the client.

6. **Rate limit**: with a key set to `rateLimitMax: 5, rateLimitTimeWindow: 60_000`,
   send 10 requests quickly. The first 5 succeed; the rest fail with the
   collector logging `rate limit exceeded`.
