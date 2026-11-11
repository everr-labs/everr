package profiler

import (
	"bytes"
	"encoding/hex"
	"testing"
	"time"

	"github.com/google/pprof/profile"
	pb "go.opentelemetry.io/proto/otlp/profiles/v1development"
)

func TestToOTLP(t *testing.T) {
	burn := &profile.Function{ID: 1, Name: "main.burn", Filename: "/src/main.go"}
	main := &profile.Function{ID: 2, Name: "main.main", Filename: "/src/main.go"}
	leaf := &profile.Location{ID: 1, Line: []profile.Line{{Function: burn, Line: 12}}}
	root := &profile.Location{ID: 2, Line: []profile.Line{{Function: main, Line: 30}}}
	cpu := &profile.Profile{
		SampleType: []*profile.ValueType{{Type: "samples", Unit: "count"}, {Type: "cpu", Unit: "nanoseconds"}},
		PeriodType: &profile.ValueType{Type: "cpu", Unit: "nanoseconds"},
		Period:     10_000_000,
		Function:   []*profile.Function{burn, main},
		Location:   []*profile.Location{leaf, root},
		Sample: []*profile.Sample{
			{
				Location: []*profile.Location{leaf, root},
				Value:    []int64{3, 30_000_000},
				Label: map[string][]string{
					"trace_id": {"0102030405060708090a0b0c0d0e0f10"},
					"span_id":  {"1112131415161718"},
					"endpoint": {"/checkout"},
				},
			},
			{Location: []*profile.Location{root}, Value: []int64{0, 0}},
		},
	}
	w := window{start: time.Unix(100, 0), duration: 15 * time.Second}

	req := toOTLP([]*profile.Profile{cpu}, w, map[string]string{"service.name": "checkout"})

	d := req.Dictionary
	text := func(i int32) string { return d.StringTable[i] }
	rp := req.ResourceProfiles[0]
	if got := rp.Resource.Attributes[0]; got.Key != "service.name" || got.Value.GetStringValue() != "checkout" {
		t.Fatalf("resource = %v", rp.Resource.Attributes)
	}
	profiles := rp.ScopeProfiles[0].Profiles
	if len(profiles) != 2 {
		t.Fatalf("got %d profiles, want one per sample type", len(profiles))
	}
	if bytes.Equal(profiles[0].ProfileId, profiles[1].ProfileId) || len(profiles[0].ProfileId) != 16 {
		t.Fatalf("profile ids must be distinct 16-byte ids: %x %x", profiles[0].ProfileId, profiles[1].ProfileId)
	}

	cpuProfile := profiles[1]
	if text(cpuProfile.SampleType.TypeStrindex) != "cpu" || text(cpuProfile.SampleType.UnitStrindex) != "nanoseconds" {
		t.Fatalf("sample type = %v", cpuProfile.SampleType)
	}
	if cpuProfile.TimeUnixNano != uint64(time.Unix(100, 0).UnixNano()) || cpuProfile.DurationNano != uint64(15*time.Second) {
		t.Fatalf("window = %d+%d", cpuProfile.TimeUnixNano, cpuProfile.DurationNano)
	}
	if len(cpuProfile.Samples) != 1 {
		t.Fatalf("zero-weight samples must be dropped, got %d samples", len(cpuProfile.Samples))
	}
	s := cpuProfile.Samples[0]
	if s.Values[0] != 30_000_000 {
		t.Fatalf("values = %v", s.Values)
	}

	var frames []string
	for _, l := range d.StackTable[s.StackIndex].LocationIndices {
		frames = append(frames, text(d.FunctionTable[d.LocationTable[l].Lines[0].FunctionIndex].NameStrindex))
	}
	if len(frames) != 2 || frames[0] != "main.burn" || frames[1] != "main.main" {
		t.Fatalf("stack = %v, want leaf first", frames)
	}

	link := d.LinkTable[s.LinkIndex]
	if hex.EncodeToString(link.TraceId) != "0102030405060708090a0b0c0d0e0f10" || hex.EncodeToString(link.SpanId) != "1112131415161718" {
		t.Fatalf("link = %x/%x", link.TraceId, link.SpanId)
	}
	attrs := sampleAttrs(d, s)
	if len(attrs) != 1 || attrs["endpoint"] != "/checkout" {
		t.Fatalf("attributes = %v, want only the goroutine label", attrs)
	}
}

func TestToOTLPKeepsSpanLabelWithoutTrace(t *testing.T) {
	fn := &profile.Function{ID: 1, Name: "main.work"}
	loc := &profile.Location{ID: 1, Line: []profile.Line{{Function: fn}}}
	p := &profile.Profile{
		SampleType: []*profile.ValueType{{Type: "cpu", Unit: "nanoseconds"}},
		Function:   []*profile.Function{fn},
		Location:   []*profile.Location{loc},
		Sample:     []*profile.Sample{{Location: []*profile.Location{loc}, Value: []int64{1}, Label: map[string][]string{"span_id": {"1112131415161718"}}}},
	}

	req := toOTLP([]*profile.Profile{p}, window{}, nil)

	s := req.ResourceProfiles[0].ScopeProfiles[0].Profiles[0].Samples[0]
	if s.LinkIndex != 0 {
		t.Fatalf("a span id alone cannot form a link")
	}
	if got := sampleAttrs(req.Dictionary, s)["span_id"]; got != "1112131415161718" {
		t.Fatalf("span_id attribute = %q", got)
	}
}

func sampleAttrs(d *pb.ProfilesDictionary, s *pb.Sample) map[string]string {
	out := map[string]string{}
	for _, i := range s.AttributeIndices {
		a := d.AttributeTable[i]
		out[d.StringTable[a.KeyStrindex]] = a.Value.GetStringValue()
	}
	return out
}
