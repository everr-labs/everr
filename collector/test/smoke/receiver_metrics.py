#!/usr/bin/env python3
"""Exercise native tenant counters and process identity in the built collector.

Uses synthetic local authentication, two collector processes, and a restart.
With --otlp-endpoint, scrapes both processes using the production contrib image
and exports the resulting operational metrics into local Everr. Requires Docker
for that optional scrape check. No production credentials are used.
"""

import argparse
import http.server
import json
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def post(url, body, key):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={
        'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
    with urllib.request.urlopen(req, timeout=10) as response:
        return response.status


def payload(signal, count):
    resource = {'attributes': [{'key': 'everr.tenant.id', 'value': {'stringValue': 'forged'}}]}
    if signal == 'traces':
        return {'resourceSpans': [{'resource': resource, 'scopeSpans': [{'spans': [
            {'traceId': uuid.uuid4().hex, 'spanId': uuid.uuid4().hex[:16], 'name': 'receiver-metric-smoke'}
            for _ in range(count)]}]}]}
    if signal == 'logs':
        return {'resourceLogs': [{'resource': resource, 'scopeLogs': [{'logRecords': [
            {'body': {'stringValue': 'receiver-metric-smoke'}} for _ in range(count)]}]}]}
    return {'resourceMetrics': [{'resource': resource, 'scopeMetrics': [{'metrics': [{
        'name': 'smoke.metric', 'gauge': {'dataPoints': [{'asInt': '1'} for _ in range(count)]}}]}]}]}


def scrape(port):
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/metrics', timeout=2) as response:
        return response.read().decode()


def samples(text, name):
    result = []
    for line in text.splitlines():
        if not line.startswith(name + '{'):
            continue
        labels = dict(re.findall(r'(\w+)="([^"]*)"', line))
        value = float(line.rsplit(' ', 1)[-1])
        result.append((labels, value))
    return result


def wait_for_scrape(process, port, log):
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError(log.read_text())
        try:
            return scrape(port)
        except (OSError, urllib.error.URLError):
            time.sleep(0.1)
    raise RuntimeError('Collector did not start: ' + log.read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, default=ROOT / 'build/everr-collector')
    parser.add_argument('--everr-cli', default='everr', help='CLI for querying the local scrape check')
    parser.add_argument('--otlp-endpoint', help='Local OTLP URL from everr local status')
    args = parser.parse_args()
    marker = 'receiver-smoke-' + uuid.uuid4().hex[:10]
    tenant_a, tenant_b = marker + '-a', marker + '-b'

    class Verify(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            if self.path.startswith('/reject/'):
                self.send_error(503, 'synthetic downstream rejection')
                return
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            tenant = {'a': tenant_a, 'b': tenant_b}.get(body.get('key'))
            if not tenant or self.headers.get('x-internal-secret') != 'local-test-secret':
                self.send_error(401)
                return
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'tenantId': tenant, 'keyId': 'synthetic',
                'logsDays': 14, 'tracesDays': 14, 'metricsDays': 14}).encode())

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Verify)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    processes, logs, bridge = [], [], None
    with tempfile.TemporaryDirectory(prefix='receiver-metrics-') as tmp:
        tmp = Path(tmp)
        def start(index):
            ingest, reject, metrics = free_port(), free_port(), free_port()
            auth = {'http': {'endpoint': f'127.0.0.1:{ingest}', 'auth': {'authenticator': 'everr_apikey'}}}
            config = {
                'extensions': {'everr_apikey': {'endpoint': f'http://127.0.0.1:{server.server_port}/verify', 'shared_secret': 'local-test-secret'}},
                'receivers': {'otlp/public': {'protocols': auth}, 'otlp/rejected': {'protocols': {
                    'http': {'endpoint': f'127.0.0.1:{reject}', 'auth': {'authenticator': 'everr_apikey'}}}}},
                'exporters': {'debug': {'verbosity': 'basic'}, 'otlphttp/rejected': {
                    'endpoint': f'http://127.0.0.1:{server.server_port}/reject',
                    'sending_queue': {'enabled': False}, 'retry_on_failure': {'enabled': False}}},
                'service': {'extensions': ['everr_apikey'], 'pipelines': {}, 'telemetry': {
                    'logs': {'level': 'error'}, 'metrics': {'level': 'normal', 'readers': [{'pull': {'exporter': {
                        'prometheus': {'host': '0.0.0.0', 'port': metrics, 'without_type_suffix': True,
                            'without_units': True, 'with_resource_constant_labels': {'included': ['service.instance.id']}}}}}]}}}}
            for signal in ('traces', 'metrics', 'logs'):
                config['service']['pipelines'][signal+'/public'] = {'receivers': ['otlp/public'], 'exporters': ['debug']}
                config['service']['pipelines'][signal+'/rejected'] = {'receivers': ['otlp/rejected'], 'exporters': ['otlphttp/rejected']}
            config_path = tmp / f'collector-{index}.json'
            config_path.write_text(json.dumps(config))
            log_path = tmp / f'collector-{index}.log'
            log = log_path.open('w'); logs.append(log)
            process = subprocess.Popen([str(args.binary), '--config', str(config_path)], stdout=log, stderr=log)
            processes.append(process)
            wait_for_scrape(process, metrics, log_path)
            return process, ingest, reject, metrics
        try:
            first, second = start(1), start(2)
            ids = []
            for collector, factor in [(first, 1), (second, 2)]:
                for signal, name in [('traces', 'spans'), ('metrics', 'metric_points'), ('logs', 'log_records')]:
                    for key, count in [('a', 7 * factor), ('b', 13 * factor)]:
                        assert post(f'http://127.0.0.1:{collector[1]}/v1/{signal}', payload(signal, count), key) == 200
                    try:
                        post(f'http://127.0.0.1:{collector[2]}/v1/{signal}', payload(signal, 3 * factor), 'a')
                        raise AssertionError('Rejected request succeeded')
                    except urllib.error.HTTPError as e:
                        assert e.code >= 400
                    accepted = samples(scrape(collector[3]), 'otelcol_receiver_accepted_' + name)
                    observed = {labels['everr_ingestion_tenant_id']: value for labels, value in accepted if labels.get('receiver') == 'otlp/public'}
                    assert observed == {tenant_a: 7 * factor, tenant_b: 13 * factor}, observed
                    refused = samples(scrape(collector[3]), 'otelcol_receiver_refused_' + name)
                    assert any(labels.get('everr_ingestion_tenant_id') == tenant_a and value == 3 * factor for labels, value in refused), refused
                    assert all(labels.get('service_instance_id') for labels, _ in accepted), accepted
                instance_ids = {labels['service_instance_id'] for labels, _ in accepted}
                assert len(instance_ids) == 1
                ids.extend(instance_ids)
            assert len(set(ids)) == 2, ids
            print('PASS: native accepted/refused counts for all signals, trusted tenant labels, and distinct process UUIDs.', flush=True)

            if args.otlp_endpoint:
                # Exercise the actual production scrape allowlist and transform.
                config_path = tmp / 'bridge.json'
                job = {'job_name': 'collector', 'scrape_interval': '1s', 'static_configs': [{'targets': [
                    f'host.docker.internal:{first[3]}', f'host.docker.internal:{second[3]}']}],
                    'metric_relabel_configs': [{'source_labels': ['__name__'], 'action': 'keep',
                        'regex': 'otelcol_receiver_(accepted|refused)_(spans|metric_points|log_records)'}]}
                host_endpoint = args.otlp_endpoint.replace('127.0.0.1', 'host.docker.internal').replace('localhost', 'host.docker.internal')
                config_path.write_text(json.dumps({'receivers': {'prometheus': {'config': {'scrape_configs': [job]}}},
                    'processors': {'transform/instance': {'error_mode': 'propagate', 'metric_statements': [{'context': 'datapoint',
                        'statements': ['set(resource.attributes["service.instance.id"], attributes["service.instance.id"]) where attributes["service.instance.id"] != nil', 'set(resource.attributes["service.instance.id"], attributes["service_instance_id"]) where attributes["service_instance_id"] != nil']}]}},
                    'exporters': {'otlphttp': {'endpoint': host_endpoint}}, 'service': {
                        'pipelines': {'metrics': {'receivers': ['prometheus'], 'processors': ['transform/instance'], 'exporters': ['otlphttp']}},
                        'telemetry': {'logs': {'level': 'error'}, 'metrics': {'level': 'none'}}}}))
                bridge = 'receiver-smoke-' + uuid.uuid4().hex[:8]
                subprocess.run(['docker', 'run', '-d', '--name', bridge, '-v', str(config_path)+':/etc/otelcol/smoke.json:ro',
                    'otel/opentelemetry-collector-contrib:0.154.0', '--config', '/etc/otelcol/smoke.json'], check=True, stdout=subprocess.DEVNULL)
                assert subprocess.check_output(['docker', 'inspect', bridge, '--format', '{{.State.Running}}'], text=True).strip() == 'true'
                query = f"""SELECT ResourceAttributes['service.instance.id'] AS instance_id,
                    Attributes['everr.ingestion.tenant.id'] AS tenant_id, MetricName,
                    min(Value) AS first_value, max(Value) AS last_value, count() AS samples
                    FROM metrics_sum WHERE TimeUnix > now() - INTERVAL 10 MINUTE
                    AND Attributes['everr.ingestion.tenant.id'] LIKE '{marker}%'
                    AND Attributes['receiver'] = 'otlp/public' AND bitAnd(Flags, 1) = 0
                    GROUP BY instance_id, tenant_id, MetricName LIMIT 30"""
                def stored():
                    return json.loads(subprocess.check_output([args.everr_cli, 'local', 'query', query, '--format', 'json'], text=True))
                def wait_for(predicate):
                    for _ in range(30):
                        rows = stored()
                        if predicate(rows): return rows
                        time.sleep(1)
                    raise AssertionError('Scraped telemetry did not match expectations: ' + json.dumps(rows))
                wait_for(lambda rows: set(r['instance_id'] for r in rows) == set(ids)
                    and all(int(r['samples']) >= 2 for r in rows))
                for collector, count in [(first, 2), (second, 4)]:
                    post(f'http://127.0.0.1:{collector[1]}/v1/traces', payload('traces', count), 'a')
                rows = wait_for(lambda rows: sum(float(r['last_value']) - float(r['first_value'])
                    for r in rows if r['tenant_id'] == tenant_a and r['MetricName'] == 'otelcol_receiver_accepted_spans') == 6)
                print(json.dumps({'local_marker': marker, 'instance_ids': ids,
                    'observed_tenant_a_span_delta': 6}), flush=True)
                print('PASS: both replicas scraped and exported through the production contrib image.', flush=True)

            first[0].terminate(); first[0].wait(timeout=15)
            restarted = start(3)
            post(f'http://127.0.0.1:{restarted[1]}/v1/traces', payload('traces', 1), 'a')
            points = samples(scrape(restarted[3]), 'otelcol_receiver_accepted_spans')
            restarted_ids = {labels['service_instance_id'] for labels, _ in points}
            assert restarted_ids.isdisjoint(ids), restarted_ids
            assert any(value == 1 for _, value in points)
            print('PASS: restart receives a fresh instance identity and fresh native counters.', flush=True)
        finally:
            if bridge:
                subprocess.run(['docker', 'rm', '-f', bridge], stdout=subprocess.DEVNULL, check=False)
            for process in processes:
                if process.poll() is None:
                    process.terminate()
                    try: process.wait(timeout=15)
                    except subprocess.TimeoutExpired: process.kill(); process.wait()
            for log in logs: log.close()
            server.shutdown(); server.server_close()


if __name__ == '__main__':
    main()
