// Copyright 2026 Giordano Ricci (operating as "Everr Labs")
// SPDX-License-Identifier: Apache-2.0

// Package pipelinetest asserts the tenant-attribution semantics of the
// collector's logs pipelines at the processor level: the public path strips a
// client-supplied everr.tenant.id and stamps the auth-derived tenant, while the
// trusted path (used by clickety-clack) preserves the incoming everr.tenant.id
// on each ResourceLogs untouched.
package pipelinetest

import (
	"context"
	"testing"
	"time"

	"github.com/open-telemetry/opentelemetry-collector-contrib/processor/attributesprocessor"
	"github.com/open-telemetry/opentelemetry-collector-contrib/processor/resourceprocessor"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/client"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/confmap"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/consumer/consumertest"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/processor"
	"go.opentelemetry.io/collector/processor/batchprocessor"
	"go.opentelemetry.io/collector/processor/processortest"
)

const tenantKey = "everr.tenant.id"

// authData is the minimal client.AuthData the public pipeline's
// resource/public_tenant processor reads via from_context: auth.tenant_id.
type authData struct{ tenantID string }

func (a authData) GetAttribute(name string) any {
	if name == "tenant_id" {
		return a.tenantID
	}
	return nil
}
func (a authData) GetAttributeNames() []string { return []string{"tenant_id"} }

func makeLogs(resourceTenantID string) plog.Logs {
	logs := plog.NewLogs()
	rl := logs.ResourceLogs().AppendEmpty()
	if resourceTenantID != "" {
		rl.Resource().Attributes().PutStr(tenantKey, resourceTenantID)
	}
	lr := rl.ScopeLogs().AppendEmpty().LogRecords().AppendEmpty()
	lr.Body().SetStr("hello")
	return logs
}

// makeMultiTenantLogs builds one OTLP plog.Logs with a ResourceLogs per tenant,
// each tagged with its own everr.tenant.id, modeling a single clickety-clack
// request that batches several tenants together.
func makeMultiTenantLogs(tenants ...string) plog.Logs {
	logs := plog.NewLogs()
	for _, tenant := range tenants {
		rl := logs.ResourceLogs().AppendEmpty()
		rl.Resource().Attributes().PutStr(tenantKey, tenant)
		rl.ScopeLogs().AppendEmpty().LogRecords().AppendEmpty().Body().SetStr("e")
	}
	return logs
}

// collectTenants returns the everr.tenant.id of each ResourceLogs across all
// emitted batches, in order.
func collectTenants(t *testing.T, batches []plog.Logs) []string {
	t.Helper()
	var got []string
	for _, b := range batches {
		rls := b.ResourceLogs()
		for i := 0; i < rls.Len(); i++ {
			v, ok := rls.At(i).Resource().Attributes().Get(tenantKey)
			require.True(t, ok, "every ResourceLogs must retain its tenant attribute")
			got = append(got, v.AsString())
		}
	}
	return got
}

// buildTrustedBatch instantiates the real batchprocessor — the only processor
// in the logs/trusted pipeline — feeding into sink. The 1ms timeout forces a
// near-immediate flush so emitted batches can be observed.
func buildTrustedBatch(t *testing.T, sink consumer.Logs) processor.Logs {
	t.Helper()
	return buildProcessor(t, batchprocessor.NewFactory(), map[string]any{
		"timeout": "1ms",
	}, sink)
}

// buildProcessor instantiates a real logs processor from a config map, the way
// the collector does at runtime.
func buildProcessor(
	t *testing.T,
	factory processor.Factory,
	cfgMap map[string]any,
	next consumer.Logs,
) processor.Logs {
	t.Helper()
	cfg := factory.CreateDefaultConfig()
	require.NoError(t, confmap.NewFromStringMap(cfgMap).Unmarshal(cfg))
	p, err := factory.CreateLogs(
		context.Background(), processortest.NewNopSettings(factory.Type()), cfg, next,
	)
	require.NoError(t, err)
	require.NoError(t, p.Start(context.Background(), componenttestHost{}))
	t.Cleanup(func() { _ = p.Shutdown(context.Background()) })
	return p
}

type componenttestHost struct{}

func (componenttestHost) GetExtensions() map[component.ID]component.Component { return nil }

// TestTrustedPath_PreservesPerResourceLogsTenant is the load-bearing proof for
// the trusted (CC) path: a single request carrying several ResourceLogs, each a
// different tenant, is run through the REAL batchprocessor (the only processor
// in logs/trusted) and every per-ResourceLogs everr.tenant.id survives
// unchanged. Because the trusted chain has no strip/stamp processor, the batch
// processor never touches attributes.
func TestTrustedPath_PreservesPerResourceLogsTenant(t *testing.T) {
	sink := new(consumertest.LogsSink)
	batch := buildTrustedBatch(t, sink)

	in := makeMultiTenantLogs("org_a", "org_b", "org_c")
	require.NoError(t, batch.ConsumeLogs(context.Background(), in))

	// The 1ms timeout flushes the pending batch; wait for it to be emitted.
	require.Eventually(t, func() bool {
		return len(collectTenants(t, sink.AllLogs())) == 3
	}, time.Second, time.Millisecond, "batched logs should be flushed")

	require.ElementsMatch(t, []string{"org_a", "org_b", "org_c"},
		collectTenants(t, sink.AllLogs()),
		"trusted path must preserve every per-ResourceLogs tenant")
}

// TestTrustedVsPublic_DiscriminatesStripStamp contrasts the two chains on the
// SAME spoofed input to make explicit that the trusted path's value is the
// ABSENCE of strip/stamp:
//   - public (strip + stamp) rewrites the spoofed tenant to the auth tenant.
//   - trusted (batch only) leaves the spoofed tenant untouched.
func TestTrustedVsPublic_DiscriminatesStripStamp(t *testing.T) {
	const spoofed = "org_attacker_spoof"
	const authTenant = "org_real_99"

	// Public chain: strip the client tenant, then stamp the auth tenant.
	publicSink := new(consumertest.LogsSink)
	stamp := buildProcessor(t, resourceprocessor.NewFactory(), map[string]any{
		"attributes": []map[string]any{
			{"action": "upsert", "key": tenantKey, "from_context": "auth.tenant_id"},
		},
	}, publicSink)
	strip := buildProcessor(t, attributesprocessor.NewFactory(), map[string]any{
		"actions": []map[string]any{
			{"action": "delete", "key": tenantKey},
		},
	}, stamp)

	ctx := client.NewContext(context.Background(), client.Info{
		Auth: authData{tenantID: authTenant},
	})
	require.NoError(t, strip.ConsumeLogs(ctx, makeLogs(spoofed)))

	require.Equal(t, []string{authTenant}, collectTenants(t, publicSink.AllLogs()),
		"public path must replace the spoofed tenant with the auth tenant")

	// Trusted chain: batch only, no strip/stamp; the spoofed tenant survives.
	trustedSink := new(consumertest.LogsSink)
	batch := buildTrustedBatch(t, trustedSink)
	require.NoError(t, batch.ConsumeLogs(context.Background(), makeLogs(spoofed)))

	require.Eventually(t, func() bool {
		return len(trustedSink.AllLogs()) == 1
	}, time.Second, time.Millisecond, "batched logs should be flushed")

	require.Equal(t, []string{spoofed}, collectTenants(t, trustedSink.AllLogs()),
		"trusted path must preserve the incoming tenant verbatim (no strip/stamp)")
}

// TestPublicPath_StripsThenStampsFromAuth is the load-bearing proof for the
// public path: a client-supplied everr.tenant.id is deleted, then the
// auth-derived tenant is stamped. Runs the real attributesprocessor and
// resourceprocessor with the exact actions from config.yml.
func TestPublicPath_StripsThenStampsFromAuth(t *testing.T) {
	sink := new(consumertest.LogsSink)

	// resource/public_tenant: upsert everr.tenant.id from auth.tenant_id.
	stamp := buildProcessor(t, resourceprocessor.NewFactory(), map[string]any{
		"attributes": []map[string]any{
			{"action": "upsert", "key": tenantKey, "from_context": "auth.tenant_id"},
		},
	}, sink)

	// attributes/strip_user_tenant: delete everr.tenant.id.
	strip := buildProcessor(t, attributesprocessor.NewFactory(), map[string]any{
		"actions": []map[string]any{
			{"action": "delete", "key": tenantKey},
		},
	}, stamp)

	// Client tries to spoof tenant via the resource attribute.
	in := makeLogs("org_attacker_spoof")

	// Auth context carries the real tenant (set by everr_apikey extension).
	ctx := client.NewContext(context.Background(), client.Info{
		Auth: authData{tenantID: "org_real_99"},
	})
	require.NoError(t, strip.ConsumeLogs(ctx, in))

	out := sink.AllLogs()
	require.Len(t, out, 1)
	got, ok := out[0].ResourceLogs().At(0).Resource().Attributes().Get(tenantKey)
	require.True(t, ok, "auth-derived tenant must be stamped")
	require.Equal(t, "org_real_99", got.AsString(),
		"public path must ignore the client-supplied tenant and use auth tenant")
}
