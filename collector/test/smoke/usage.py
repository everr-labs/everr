#!/usr/bin/env python3
"""Opt-in usage integration test against local ClickHouse and the built collector.

Requires Docker Compose's initialized ClickHouse and `make build` in collector.
Creates uniquely named synthetic tenants and leaves their test telemetry in the
local database. Uses a temporary queue directory and never stops the database.
Optionally replays the stored usage rows into local Everr to exercise the exact
same customer-visible query there. No production credentials are needed.
"""

import argparse
import copy
from datetime import datetime, timezone
import http.server
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]


def post(url, body, headers=None):
    request = urllib.request.Request(url, data=json.dumps(body).encode(), headers={
        'Content-Type': 'application/json', **(headers or {})})
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.status



def verify_month_query(db):
    # Read-only fixtures: late September snapshots, duplicates, a restart,
    # a mismatched owner, October usage, and Float64 rounding above 2^53.
    fixture = """(
        SELECT 'everr-ingestion' AS ServiceName,
            'everr.ingestion.volume' AS MetricName,
            map('everr.usage.month', month, 'everr.usage.tenant.id', customer,
                'everr.ingestion.signal', 'logs') AS Attributes,
            map('everr.tenant.id', owner, 'service.instance.id', instance) AS ResourceAttributes,
            started AS StartTimeUnix,
            toDateTime('2026-10-01 00:00:05', 'UTC') AS TimeUnix,
            toFloat64(bytes) AS Value, 2 AS AggregationTemporality,
            true AS IsMonotonic, 'By' AS MetricUnit,
            'github.com/everr-labs/everr/collector/usage' AS ScopeName, '1' AS ScopeVersion
        FROM values('month String, customer String, owner String, instance String, started DateTime, bytes Int64',
            ('2026-09', 'a', 'a', 'one', '2026-09-30 23:58:00', 200),
            ('2026-09', 'a', 'a', 'one', '2026-09-30 23:58:00', 400),
            ('2026-09', 'a', 'a', 'one', '2026-09-30 23:58:00', 400),
            ('2026-09', 'a', 'other', 'one', '2026-09-30 23:58:00', 400),
            ('2026-09', 'a', 'a', 'two', '2026-09-30 23:59:00', 50),
            ('2026-10', 'a', 'a', 'one', '2026-10-01 00:00:00', 300),
            ('2026-09', 'large', 'large', 'one', '2026-09-30 23:58:00', 9007199254740995)
        )
    )"""
    query = (ROOT / 'extension/everrusageextension/customer-usage.sql').read_text().replace('FROM metrics_sum', 'FROM ' + fixture)
    september = {r['customer']: int(r['bytes']) for r in db(query.replace('{month:String}', "'2026-09'"))}
    assert september['a'] == 450, september
    assert 9007199254740995-1024 <= september['large'] <= 9007199254740995, september
    assert db(query.replace('{month:String}', "'2026-10'")) == [{'customer': 'a', 'signal': 'logs', 'bytes': 300}]
    # Mutate one contract field at a time; otherwise these are billable rows.
    for field, original, invalid in [
        ('IsMonotonic', 'true AS IsMonotonic', 'false AS IsMonotonic'),
        ('MetricUnit', "'By' AS MetricUnit", "'1' AS MetricUnit"),
        ('ScopeName', "'github.com/everr-labs/everr/collector/usage' AS ScopeName", "'other' AS ScopeName"),
        ('ScopeVersion', "'1' AS ScopeVersion", "'2' AS ScopeVersion"),
    ]:
        malformed = query.replace(original, invalid).replace('{month:String}', "'2026-09'")
        assert db(malformed) == [], f'{field}: malformed usage was billed'
    print('PASS: canonical monthly query enforces the metric contract and handles late publication, resets, copies, and large-counter rounding.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', default='ttl-improvements-clickhouse-1')
    parser.add_argument('--clickhouse', default='http://127.0.0.1:8123')
    parser.add_argument('--everr-cli', help='Also verify stored rows using local Everr, e.g. everr-dev')
    args = parser.parse_args()
    month = datetime.now(timezone.utc).strftime('%Y-%m')
    run = 'usage-smoke-' + uuid.uuid4().hex
    tenants = {key: run + '-' + key for key in ['a', 'b', 'c']}
    failures = {'outage': True, 'rejected': 0, 'ambiguous': 0, 'remaining': 2}
    failure_lock = threading.Lock()

    class QuietHandler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

    class Verify(QuietHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            if self.headers.get('x-internal-secret') != run or body.get('key') not in tenants:
                self.send_response(403)
                self.end_headers()
                return
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps(dict(tenantId=tenants[body['key']], keyId=body['key'],
                                            logsDays=14, tracesDays=14, metricsDays=14)).encode())

    class Proxy(QuietHandler):
        def do_POST(self):
            if self.headers.get('Transfer-Encoding', '').lower() == 'chunked':
                chunks = []
                while True:
                    size = int(self.rfile.readline().strip().split(b';')[0], 16)
                    if size == 0:
                        self.rfile.readline()
                        break
                    chunks.append(self.rfile.read(size))
                    self.rfile.read(2)
                data = b''.join(chunks)
            else:
                data = self.rfile.read(int(self.headers.get('Content-Length', '0')))
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get('query', [''])[0]
            is_insert = query.lstrip().upper().startswith('INSERT')
            with failure_lock:
                unavailable = failures['outage'] and is_insert
                if unavailable:
                    failures['rejected'] += 1
            if unavailable:
                self.send_response(503)
                self.end_headers()
                self.wfile.write(b'simulated storage outage')
                return
            headers = {k: v for k, v in self.headers.items()
                       if k.lower() not in ['host', 'transfer-encoding', 'content-length']}
            request = urllib.request.Request(args.clickhouse + self.path, data=data, headers=headers)
            try:
                with urllib.request.urlopen(request, timeout=20) as response:
                    body, status = response.read(), response.status
            except urllib.error.HTTPError as error:
                body, status = error.read(), error.code
            # Commit the real insert, then return a retryable error instead of its ACK.
            with failure_lock:
                if status == 200 and is_insert and 'otel_metrics_sum' in query and failures['remaining']:
                    failures['remaining'] -= 1
                    failures['ambiguous'] += 1
                    status, body = 503, b'simulated lost write acknowledgment'
            self.send_response(status)
            self.end_headers()
            try:
                self.wfile.write(body)
            except BrokenPipeError:
                pass

    def server(handler):
        result = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        threading.Thread(target=result.serve_forever, daemon=True).start()
        return result

    def db(sql):
        output = subprocess.check_output(['docker', 'exec', args.container, 'clickhouse-client',
                                          '--query', sql + ' FORMAT JSONEachRow'], text=True)
        return [json.loads(line) for line in output.splitlines()]

    def eventually(check):
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if check():
                return
            time.sleep(.2)
        raise AssertionError('condition did not become true within 30 seconds')

    verify_month_query(db)
    verify, proxy = server(Verify), server(Proxy)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix='everr-usage-smoke-') as temp:
        temp = Path(temp)
        config = {
            'extensions': {
                'everr_usage': {},
                'everr_apikey': {'endpoint': f'http://127.0.0.1:{verify.server_port}/verify', 'shared_secret': run},
                'file_storage/ingestion': {'directory': str(temp / 'queue'), 'create_directory': True, 'fsync': True}},
            'connectors': {'everr_usage_connector': {'interval': '1s'}},
            'receivers': {
                'otlp': {'protocols': {'http': {'endpoint': f'127.0.0.1:{port}', 'auth': {'authenticator': 'everr_apikey'}}}}},
            'processors': {
                # Accelerate idle expiry; upstream's cleanup ticker still runs once per minute.
                'delta_to_cumulative/usage': {'max_stale': '2s', 'max_streams': 60000},
                'resource/tenant': {'attributes': [
                    {'action': 'upsert', 'key': 'everr.tenant.id', 'from_context': 'auth.tenant_id'},
                    {'action': 'upsert', 'key': 'everr.retention.days', 'value': '14'}]},
                'filter/reserved_everr': {'error_mode': 'propagate', 'metric_conditions': ['IsMatch(metric.name, "^everr[.]")']},
                'everr_usage': {}},
            'exporters': {'clickhouse': {
                'endpoint': f'http://127.0.0.1:{proxy.server_port}',
                'username': os.environ.get('CLICKHOUSE_USERNAME', 'collector_rw'),
                'password': os.environ.get('CLICKHOUSE_PASSWORD', 'collector-dev'),
                'database': 'otel', 'create_schema': False, 'json': True,
                # Disable server deduplication so the test proves the query handles actual duplicate rows.
                'connection_params': {'wait_for_async_insert': '1', 'materialized_views_ignore_errors': '0', 'insert_deduplicate': '0'},
                'sending_queue': {'enabled': True, 'storage': 'file_storage/ingestion', 'wait_for_result': False,
                                  'queue_size': 10000, 'batch': {'min_size': 8192, 'flush_timeout': '100ms'}},
                'retry_on_failure': {'enabled': True, 'initial_interval': '100ms', 'max_interval': '100ms', 'max_elapsed_time': '0s'}}},
            'service': {'telemetry': {'metrics': {'level': 'none'}}, 'extensions': ['everr_usage', 'everr_apikey', 'file_storage/ingestion'], 'pipelines': {
                'metrics/usage': {'receivers': ['everr_usage_connector'], 'processors': ['delta_to_cumulative/usage'], 'exporters': ['clickhouse/usage']}}}}
        for signal in ['logs', 'traces', 'metrics']:
            processors = ['resource/tenant', 'everr_usage']
            if signal == 'metrics':
                processors.insert(0, 'filter/reserved_everr')
            config['service']['pipelines'][signal] = {'receivers': ['otlp'], 'processors': processors, 'exporters': ['clickhouse', 'everr_usage_connector']}
        config['exporters']['clickhouse/usage'] = copy.deepcopy(config['exporters']['clickhouse'])
        config['exporters']['clickhouse/usage']['sending_queue']['block_on_overflow'] = True
        (temp / 'config.json').write_text(json.dumps(config))
        log_path = temp / 'collector.log'
        log = log_path.open('w')
        proc = None

        def start():
            process = subprocess.Popen([str(ROOT / 'build/everr-collector'), '--config', str(temp / 'config.json')],
                                       stdout=log, stderr=log)
            def ready():
                if process.poll() is not None:
                    raise RuntimeError(log_path.read_text())
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=.1):
                        return True
                except OSError:
                    return False
            eventually(ready)
            return process

        usage_where = f"ServiceName='everr-ingestion' AND MetricName='everr.ingestion.volume' AND startsWith(Attributes['everr.usage.tenant.id'], '{run}') AND TimeUnix > now()-INTERVAL 10 MINUTE"
        query = (ROOT / 'extension/everrusageextension/customer-usage.sql').read_text()
        query = query.replace('{month:String}', "'" + month + "'")
        query = query.replace("AND MetricName = 'everr.ingestion.volume'", f"AND MetricName = 'everr.ingestion.volume' AND startsWith(Attributes['everr.usage.tenant.id'], '{run}')")

        def totals():
            return db(query.replace('FROM metrics_sum', 'FROM app.metrics_sum'))

        requests = []
        try:
            proc = start()
            for key in tenants:
                now = str(time.time_ns())
                resource = {'attributes': [{'key': 'service.name', 'value': {'stringValue': run}},
                                           {'key': 'everr.tenant.id', 'value': {'stringValue': 'forged'}}]}
                point = {'timeUnixNano': now, 'asInt': '1'}
                bodies = {
                    'logs': {'resourceLogs': [{'resource': resource, 'scopeLogs': [{'logRecords': [{'timeUnixNano': now, 'body': {'stringValue': run}}]}]}]},
                    'traces': {'resourceSpans': [{'resource': resource, 'scopeSpans': [{'spans': [{'traceId': uuid.uuid4().hex, 'spanId': uuid.uuid4().hex[:16], 'name': run, 'startTimeUnixNano': now, 'endTimeUnixNano': str(int(now)+1000000)}]}]}]},
                    'metrics': {'resourceMetrics': [{'resource': resource, 'scopeMetrics': [{'metrics': [
                        {'name': run+'.gauge', 'gauge': {'dataPoints': [point]}},
                        {'name': run+'.sum', 'sum': {'aggregationTemporality': 1, 'isMonotonic': True, 'dataPoints': [point]}},
                        {'name': run+'.histogram', 'histogram': {'aggregationTemporality': 1, 'dataPoints': [{'timeUnixNano': now, 'count': '1', 'bucketCounts': ['1']}]}},
                        {'name': run+'.exponential', 'exponentialHistogram': {'aggregationTemporality': 1, 'dataPoints': [{'timeUnixNano': now, 'count': '1', 'zeroCount': '1'}]}},
                        {'name': run+'.summary', 'summary': {'dataPoints': [{'timeUnixNano': now, 'count': '1', 'sum': 1}]}},
                        {'name': 'everr.ingestion.volume', 'sum': {'aggregationTemporality': 1, 'dataPoints': [point]}}
                    ]}]}]}}
                for signal, body in bodies.items():
                    item = (f'http://127.0.0.1:{port}/v1/{signal}', body, {'Authorization': 'Bearer '+key})
                    assert post(*item) == 200
                    requests.append(item)
            time.sleep(3)
            assert failures['rejected'] > 0 and totals() == []
            # Original data and usage are persisted in separate exporter queues during the outage.
            proc.kill()
            proc.wait(timeout=10)
            failures['outage'] = False
            proc = start()
            eventually(lambda: len(totals()) == 9 and failures['ambiguous'] == 2)
            time.sleep(2)
            before = totals()
            assert all(int(row['bytes']) > 0 for row in before)
            print('Customer-owned totals after crash recovery and ambiguous retries:', before, flush=True)
            raw = db(f"SELECT count() AS rows, uniqExact(tuple(tenant_id, ResourceAttributes['service.instance.id'], Attributes['everr.usage.tenant.id'], Attributes['everr.ingestion.signal'], StartTimeUnix)) AS identities FROM app.metrics_sum WHERE {usage_where}")[0]
            assert raw['rows'] > raw['identities'], raw
            repeated = db(f"SELECT count() AS copies FROM app.metrics_sum WHERE {usage_where} AND tenant_id=Attributes['everr.usage.tenant.id'] GROUP BY tenant_id, ResourceAttributes['service.instance.id'], Attributes['everr.ingestion.signal'], StartTimeUnix HAVING copies>1 LIMIT 1")
            assert repeated, 'must observe actual retried customer rows'
            print('Actual duplicate rows:', raw, flush=True)
            copies = db(f"SELECT Attributes['everr.usage.tenant.id'] AS customer, Attributes['everr.ingestion.signal'] AS signal, ResourceAttributes['service.instance.id'] AS instance, StartTimeUnix AS counter_start, groupUniqArray(tenant_id) AS owners, uniqExact(tuple(Value, StartTimeUnix, TimeUnix)) AS values, min(retention_days) AS retention FROM app.metrics_sum WHERE {usage_where} GROUP BY customer, signal, instance, counter_start")
            for row in copies:
                assert set(row['owners']) == {row['customer']}, row
                assert row['values'] == 1 and row['retention'] == 365, row
            for table, stamp in [('logs', 'Timestamp'), ('traces', 'Timestamp'), ('metrics_gauge', 'TimeUnix'), ('metrics_sum', 'TimeUnix'), ('metrics_histogram', 'TimeUnix'), ('metrics_exponential_histogram', 'TimeUnix'), ('metrics_summary', 'TimeUnix')]:
                assert db(f"SELECT uniqExact(tenant_id) AS tenants FROM app.{table} WHERE ServiceName='{run}' AND {stamp}>now()-INTERVAL 10 MINUTE")[0]['tenants'] == 3
            assert db(f"SELECT count() AS rows FROM app.metrics_sum WHERE ServiceName='{run}' AND startsWith(MetricName, 'everr.') AND TimeUnix>now()-INTERVAL 10 MINUTE")[0]['rows'] == 0
            forged = {'resourceMetrics': [{'scopeMetrics': [{'metrics': [{'name': 'everr.other.metric', 'gauge': {'dataPoints': [point]}}]}]}]}
            post(f'http://127.0.0.1:{port}/v1/metrics', forged, {'Authorization': 'Bearer a'})
            time.sleep(2)
            assert totals() == before, 'idle time, replay, and filtered metrics must not add usage'
            for item in requests:
                post(*item)
            expected = {(r['customer'], r['signal']): int(r['bytes'])*2 for r in before}
            eventually(lambda: {(r['customer'], r['signal']): int(r['bytes']) for r in totals()} == expected)
            print('Fresh admissions counted exactly once for each tenant.', flush=True)
            # Another sample in the same lifetime must increase its max, not its row sum.
            for item in requests:
                post(*item)
            expected = {(r['customer'], r['signal']): int(r['bytes'])*3 for r in before}
            eventually(lambda: {(r['customer'], r['signal']): int(r['bytes']) for r in totals()} == expected)
            identities_before = db(f"SELECT uniqExact(tuple(tenant_id, ResourceAttributes['service.instance.id'], Attributes['everr.usage.tenant.id'], Attributes['everr.ingestion.signal'], StartTimeUnix)) AS n FROM app.metrics_sum WHERE {usage_where}")[0]['n']
            rows_before = db(f"SELECT count() AS n FROM app.metrics_sum WHERE {usage_where}")[0]['n']
            print('Waiting 65 seconds for the standard processor to evict idle counters...', flush=True)
            # Uses the real upstream expiry path, with no custom clock or expiry implementation.
            for _ in range(13):
                time.sleep(5)
                assert proc.poll() is None
            assert db(f"SELECT count() AS n FROM app.metrics_sum WHERE {usage_where}")[0]['n'] == rows_before, 'idle counters must not emit points'
            for item in requests:
                post(*item)
            expected = {(r['customer'], r['signal']): int(r['bytes'])*4 for r in before}
            eventually(lambda: {(r['customer'], r['signal']): int(r['bytes']) for r in totals()} == expected)
            identities_after = db(f"SELECT uniqExact(tuple(tenant_id, ResourceAttributes['service.instance.id'], Attributes['everr.usage.tenant.id'], Attributes['everr.ingestion.signal'], StartTimeUnix)) AS n FROM app.metrics_sum WHERE {usage_where}")[0]['n']
            assert identities_after == identities_before + 9, (identities_before, identities_after)
            assert db(f"SELECT uniqExact(AggregationTemporality) AS n, min(AggregationTemporality) AS temporality FROM app.metrics_sum WHERE {usage_where}")[0] == {'n': 1, 'temporality': 2}
            print('PASS: idle expiry and resumption created new lifetimes without losing or double-counting prior usage.', flush=True)

            # Verify final publication with the production interval: no periodic
            # tick may account for these admissions before SIGTERM.
            proc.terminate()
            assert proc.wait(timeout=60) == 0
            config['connectors']['everr_usage_connector']['interval'] = '60s'
            (temp / 'config.json').write_text(json.dumps(config))
            began = time.monotonic()
            proc = start()
            for item in requests:
                assert post(*item) == 200
            assert time.monotonic() - began < 60, 'a periodic publication could mask the shutdown test'
            stopped = time.monotonic()
            proc.terminate()
            assert proc.wait(timeout=60) == 0
            elapsed = time.monotonic() - stopped
            # Native exporter shutdown may leave the final snapshot persisted
            # for recovery. Restart without sending any more source telemetry.
            proc = start()
            expected = {(r['customer'], r['signal']): int(r['bytes'])*5 for r in before}
            eventually(lambda: {(r['customer'], r['signal']): int(r['bytes']) for r in totals()} == expected)
            print(f'PASS: SIGTERM finished in {elapsed:.2f}s within the 60s grace; final usage survived shutdown/recovery.', flush=True)

            if args.everr_cli:
                status = subprocess.check_output([args.everr_cli, 'local', 'status'], text=True)
                endpoint = next(line.split(': ', 1)[1] for line in status.splitlines() if line.startswith('otlp: '))
                # Replay exactly the stored usage rows, including duplicates, into local Everr.
                rows = db(f"SELECT ResourceAttributes AS resource, Attributes AS attributes, toString(toUnixTimestamp(StartTimeUnix)*1000000000) AS start, toString(toUnixTimestamp(TimeUnix)*1000000000) AS end, toString(toUInt64(Value)) AS bytes FROM app.metrics_sum WHERE {usage_where}")
                resource_metrics = []
                def attributes(items):
                    return [{'key': k, 'value': {'stringValue': str(v)}} for k, v in items.items()]
                for row in rows:
                    resource_metrics.append({'resource': {'attributes': attributes(row['resource'])}, 'scopeMetrics': [{'scope': {'name': 'github.com/everr-labs/everr/collector/usage', 'version': '1'}, 'metrics': [{'name': 'everr.ingestion.volume', 'unit': 'By', 'sum': {'aggregationTemporality': 2, 'isMonotonic': True, 'dataPoints': [{'attributes': attributes(row['attributes']), 'startTimeUnixNano': row['start'], 'timeUnixNano': row['end'], 'asInt': row['bytes']}]}}]}]})
                post(endpoint+'/v1/metrics', {'resourceMetrics': resource_metrics})
                def everr_totals():
                    output = subprocess.check_output([args.everr_cli, 'local', 'query', '--', query], text=True)
                    return {(r['customer'], r['signal']): int(r['bytes']) for r in map(json.loads, output.splitlines())}
                eventually(lambda: everr_totals() == expected)
                print('PASS: same canonical totals verified through Everr from stored rows, including duplicates.', flush=True)
            print('PASS: isolated telemetry and usage exporters, customer-only usage, namespace filtering, durable recovery, retry-safe totals.', flush=True)
        except BaseException:
            print(log_path.read_text()[-12000:])
            raise
        finally:
            if proc is not None and proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=60)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
            log.close()
            verify.shutdown()
            proxy.shutdown()


if __name__ == '__main__':
    main()
