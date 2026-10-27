//go:build integration

package cloudrecordings

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/docker/docker/pkg/stdcopy"
	routingconnector "github.com/open-telemetry/opentelemetry-collector-contrib/connector/routingconnector"
	clickhouseexporter "github.com/open-telemetry/opentelemetry-collector-contrib/exporter/clickhouseexporter"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/config/configgrpc"
	"go.opentelemetry.io/collector/config/confighttp"
	"go.opentelemetry.io/collector/config/configopaque"
	"go.opentelemetry.io/collector/config/configoptional"
	"go.opentelemetry.io/collector/connector"
	"go.opentelemetry.io/collector/exporter"
	"go.opentelemetry.io/collector/exporter/exporterhelper"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pipeline"
	"go.opentelemetry.io/collector/receiver"
	"go.opentelemetry.io/collector/receiver/otlpreceiver"
	"go.opentelemetry.io/collector/service"
	"go.opentelemetry.io/collector/service/pipelines"
	"go.opentelemetry.io/collector/service/telemetry"
)

const (
	segmentEvent  = "everr.browser.recording.segment"
	markEvent     = "everr.browser.recording.mark"
	ordinaryEvent = "browser.navigation"
	tenantID      = "org_acme"
	serviceName   = "browser"
	sessionID     = "sess-1"
	streamID      = "stream-1"
	clipID        = "clip-1"
	segmentBody   = "segment-body"
	markBody      = "mark-body"
	ordinaryBody  = "ordinary-body"
)

func TestRecordingSegmentLandsInAppRecordings(t *testing.T) {
	ctx := t.Context()
	ch := startClickHouse(t, ctx)
	endpoint := freeAddr(t)

	srv := startCollector(t, ctx, endpoint, ch.httpURL)
	defer func() {
		require.NoError(t, srv.Shutdown(context.Background()))
	}()

	// A Segment without everr.retention.days fails the MATERIALIZED expression
	// and is not stored.
	missingRetention, err := (&plog.ProtoMarshaler{}).MarshalLogs(segmentWithoutRetention())
	require.NoError(t, err)
	_ = postLogs(ctx, "http://"+endpoint, missingRetention)

	body, err := (&plog.ProtoMarshaler{}).MarshalLogs(recordingBatch())
	require.NoError(t, err)
	require.NoError(t, postLogs(ctx, "http://"+endpoint, body))

	wantRecording := strings.Join([]string{
		tenantID, "30", serviceName, segmentEvent, segmentBody, sessionID, streamID, clipID,
	}, "\t")
	wantLogs := strings.Join([]string{
		ordinaryEvent + "\t" + ordinaryBody,
		markEvent + "\t" + markBody,
	}, "\n")

	recordingsQuery := "SELECT tenant_id, toString(retention_days), ServiceName, EventName, Body, " +
		"session_id, stream_id, clip_id FROM app.recordings ORDER BY EventName FORMAT TabSeparated"
	require.Eventually(t, func() bool {
		got, err := ch.query(ctx, recordingsQuery)
		return err == nil && strings.TrimSpace(got) == wantRecording
	}, 30*time.Second, 200*time.Millisecond)

	logs, err := ch.query(ctx, `SELECT EventName, Body FROM app.logs ORDER BY EventName FORMAT TabSeparated`)
	require.NoError(t, err)
	require.Equal(t, wantLogs, strings.TrimSpace(logs))
	require.NotContains(t, logs, segmentEvent)
}

func segmentWithoutRetention() plog.Logs {
	md := plog.NewLogs()
	rl := md.ResourceLogs().AppendEmpty()
	rl.Resource().Attributes().PutStr("service.name", serviceName)
	rl.Resource().Attributes().PutStr("everr.tenant.id", tenantID)
	scope := rl.ScopeLogs().AppendEmpty()
	rec := scope.LogRecords().AppendEmpty()
	rec.SetTimestamp(pcommon.NewTimestampFromTime(time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)))
	rec.SetEventName(segmentEvent)
	rec.Body().SetStr("rejected-body")
	rec.Attributes().PutStr("session.id", "sess-rejected")
	rec.Attributes().PutStr("everr.recording.stream.id", "stream-rejected")
	rec.Attributes().PutStr("everr.recording.clip.id", "clip-rejected")
	return md
}

func recordingBatch() plog.Logs {
	md := plog.NewLogs()
	rl := md.ResourceLogs().AppendEmpty()
	rl.Resource().Attributes().PutStr("service.name", serviceName)
	rl.Resource().Attributes().PutStr("everr.tenant.id", tenantID)
	rl.Resource().Attributes().PutStr("everr.retention.days", "30")
	scope := rl.ScopeLogs().AppendEmpty()
	add := func(name, body string, attrs map[string]string) {
		rec := scope.LogRecords().AppendEmpty()
		rec.SetTimestamp(pcommon.NewTimestampFromTime(time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)))
		rec.SetEventName(name)
		rec.Body().SetStr(body)
		for k, v := range attrs {
			rec.Attributes().PutStr(k, v)
		}
	}
	add(segmentEvent, segmentBody, map[string]string{
		"session.id":                sessionID,
		"everr.recording.stream.id": streamID,
		"everr.recording.clip.id":   clipID,
	})
	add(markEvent, markBody, nil)
	add(ordinaryEvent, ordinaryBody, nil)
	return md
}

func startCollector(t *testing.T, ctx context.Context, listen, clickhouseURL string) *service.Service {
	t.Helper()
	otlpFactory := otlpreceiver.NewFactory()
	routingFactory := routingconnector.NewFactory()
	chFactory := clickhouseexporter.NewFactory()

	otlpID := component.NewID(otlpFactory.Type())
	routingID := component.NewID(routingFactory.Type())
	logsID := component.NewID(chFactory.Type())
	recordingsID := component.NewIDWithName(chFactory.Type(), "recordings")

	logsPipeline := pipeline.NewID(pipeline.SignalLogs)
	telemetryPipeline := pipeline.NewIDWithName(pipeline.SignalLogs, "telemetry")
	recordingsPipeline := pipeline.NewIDWithName(pipeline.SignalLogs, "recordings")

	otlpCfg := otlpFactory.CreateDefaultConfig().(*otlpreceiver.Config)
	httpCfg := confighttp.NewDefaultServerConfig()
	httpCfg.NetAddr.Endpoint = listen
	otlpCfg.Protocols.GRPC = configoptional.None[configgrpc.ServerConfig]()
	otlpCfg.Protocols.HTTP = configoptional.Some(otlpreceiver.HTTPConfig{
		ServerConfig:   httpCfg,
		TracesURLPath:  "/v1/traces",
		MetricsURLPath: "/v1/metrics",
		LogsURLPath:    "/v1/logs",
	})

	routingCfg := routingFactory.CreateDefaultConfig().(*routingconnector.Config)
	routingCfg.DefaultPipelines = []pipeline.ID{telemetryPipeline}
	routingCfg.Table = []routingconnector.RoutingTableItem{{
		Condition: fmt.Sprintf(`log.event_name == %q`, segmentEvent),
		Pipelines: []pipeline.ID{recordingsPipeline},
	}}

	set := service.Settings{
		BuildInfo:         component.NewDefaultBuildInfo(),
		AsyncErrorChannel: make(chan error, 4),
		TelemetryFactory:  telemetry.NewFactory(func() component.Config { return nil }),
		ReceiversConfigs:  map[component.ID]component.Config{otlpID: otlpCfg},
		ReceiversFactories: map[component.Type]receiver.Factory{
			otlpFactory.Type(): otlpFactory,
		},
		ExportersConfigs: map[component.ID]component.Config{
			logsID:       clickhouseConfig(clickhouseURL, "otel", "otel_logs", true),
			recordingsID: clickhouseConfig(clickhouseURL, "app", "recordings", false),
		},
		ExportersFactories: map[component.Type]exporter.Factory{
			chFactory.Type(): chFactory,
		},
		ConnectorsConfigs: map[component.ID]component.Config{routingID: routingCfg},
		ConnectorsFactories: map[component.Type]connector.Factory{
			routingFactory.Type(): routingFactory,
		},
	}
	pipes := pipelines.Config{
		logsPipeline: &pipelines.PipelineConfig{
			Receivers: []component.ID{otlpID},
			Exporters: []component.ID{routingID},
		},
		telemetryPipeline: &pipelines.PipelineConfig{
			Receivers: []component.ID{routingID},
			Exporters: []component.ID{logsID},
		},
		recordingsPipeline: &pipelines.PipelineConfig{
			Receivers: []component.ID{routingID},
			Exporters: []component.ID{recordingsID},
		},
	}
	srv, err := service.New(ctx, set, service.Config{Pipelines: pipes})
	require.NoError(t, err)
	require.NoError(t, srv.Start(ctx))
	return srv
}

func clickhouseConfig(endpoint, database, logsTable string, withMV bool) *clickhouseexporter.Config {
	cfg := clickhouseexporter.NewFactory().CreateDefaultConfig().(*clickhouseexporter.Config)
	cfg.Endpoint = endpoint
	cfg.Username = "default"
	cfg.Password = configopaque.String("")
	cfg.Database = database
	cfg.LogsTableName = logsTable
	cfg.CreateSchema = false
	cfg.JSON = true
	cfg.AsyncInsert = true
	cfg.QueueSettings = configoptional.None[exporterhelper.QueueBatchConfig]()
	cfg.BackOffConfig.Enabled = false
	cfg.TimeoutSettings.Timeout = 30 * time.Second
	cfg.ConnectionParams = map[string]string{
		"wait_for_async_insert": "1",
	}
	if withMV {
		cfg.ConnectionParams["materialized_views_ignore_errors"] = "0"
	}
	return cfg
}

type clickHouse struct {
	httpURL string
	c       testcontainers.Container
}

func startClickHouse(t *testing.T, ctx context.Context) *clickHouse {
	t.Helper()
	root := repoRoot(t)
	users := filepath.Join(t.TempDir(), "allow-default.xml")
	require.NoError(t, writeFile(users, allowDefaultUserXML))

	c, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "clickhouse/clickhouse-server:26.8.34.13",
			ExposedPorts: []string{"8123/tcp", "9000/tcp"},
			Files: []testcontainers.ContainerFile{
				file(users, "/etc/clickhouse-server/users.d/allow-default.xml"),
				file(filepath.Join(root, "clickhouse/init/shared/03-create-otel-tables.sql"), "/everr-init/03.sql"),
				file(filepath.Join(root, "clickhouse/init/shared/04-create-error-fingerprint-function.sql"), "/everr-init/04.sql"),
				file(filepath.Join(root, "clickhouse/init/shared/05-create-retention-functions.sql"), "/everr-init/05.sql"),
				file(filepath.Join(root, "clickhouse/init/shared/10-create-mvs.sql"), "/everr-init/10.sql"),
				file(filepath.Join(root, "clickhouse/init/shared/13-create-recordings.sql"), "/everr-init/13.sql"),
			},
			WaitingFor: wait.ForHTTP("/ping").WithPort("8123/tcp").WithStartupTimeout(2 * time.Minute),
		},
		Started: true,
	})
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, c.Terminate(context.Background()))
	})

	host, err := c.Host(ctx)
	require.NoError(t, err)
	port, err := c.MappedPort(ctx, "8123/tcp")
	require.NoError(t, err)

	ch := &clickHouse{httpURL: "http://" + host + ":" + port.Port(), c: c}
	require.NoError(t, ch.exec(ctx, "clickhouse-client", "--multiquery", "--query",
		"CREATE DATABASE IF NOT EXISTS otel; CREATE DATABASE IF NOT EXISTS app; CREATE USER IF NOT EXISTS collector_rw;"))
	for _, path := range []string{"/everr-init/03.sql", "/everr-init/04.sql", "/everr-init/05.sql", "/everr-init/10.sql", "/everr-init/13.sql"} {
		require.NoError(t, ch.exec(ctx, "clickhouse-client", "--multiquery", "--queries-file", path))
	}
	return ch
}

func (ch *clickHouse) exec(ctx context.Context, args ...string) error {
	code, reader, err := ch.c.Exec(ctx, args)
	if err != nil {
		return err
	}
	var stdout, stderr bytes.Buffer
	if _, err := stdcopy.StdCopy(&stdout, &stderr, reader); err != nil {
		return err
	}
	if code != 0 {
		return fmt.Errorf("exit %d: %s%s", code, stdout.String(), stderr.String())
	}
	return nil
}

func (ch *clickHouse) query(ctx context.Context, q string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ch.httpURL, strings.NewReader(q))
	if err != nil {
		return "", err
	}
	req.Header.Set("X-ClickHouse-User", "default")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("status %d: %s", resp.StatusCode, body)
	}
	return string(body), nil
}

func postLogs(ctx context.Context, base string, body []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/v1/logs", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-protobuf")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("otlp status %d: %s", resp.StatusCode, respBody)
	}
	return nil
}

func file(hostPath, containerPath string) testcontainers.ContainerFile {
	return testcontainers.ContainerFile{
		HostFilePath:      hostPath,
		ContainerFilePath: containerPath,
		FileMode:          0o644,
	}
}

func repoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	require.True(t, ok)
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", ".."))
}

func freeAddr(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	addr := ln.Addr().String()
	require.NoError(t, ln.Close())
	return addr
}

func writeFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0o644)
}

const allowDefaultUserXML = `<clickhouse>
  <users>
    <default>
      <networks replace="replace">
        <ip>::/0</ip>
      </networks>
    </default>
  </users>
</clickhouse>
`
