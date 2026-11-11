package profiler

import (
	"crypto/rand"
	"encoding/hex"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/pprof/profile"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	pb "go.opentelemetry.io/proto/otlp/profiles/v1development"
	resourcepb "go.opentelemetry.io/proto/otlp/resource/v1"
)

// Labels set by TracerProvider. A sample carrying both links to that span.
const (
	traceIDLabel = "trace_id"
	spanIDLabel  = "span_id"
)

// window is the stretch of time a pprof profile covers.
type window struct {
	start    time.Time
	duration time.Duration
}

// toOTLP re-encodes pprof profiles as one OTLP profiles request. Every profile
// shares the request's dictionary, so a stack seen by both the CPU and the heap
// profiler is written once. Each pprof sample type becomes its own OTLP
// profile with its own ProfileId.
//
// ProfilesData and ExportProfilesServiceRequest have the same fields, so the
// marshaled ProfilesData is the request body.
func toOTLP(profiles []*profile.Profile, w window, resource map[string]string) *pb.ProfilesData {
	d := newDictionary()
	var out []*pb.Profile
	for _, p := range profiles {
		out = append(out, d.convert(p, w)...)
	}
	return &pb.ProfilesData{
		ResourceProfiles: []*pb.ResourceProfiles{{
			Resource: &resourcepb.Resource{Attributes: keyValues(resource)},
			ScopeProfiles: []*pb.ScopeProfiles{{
				Scope:    &commonpb.InstrumentationScope{Name: scopeName, Version: version},
				Profiles: out,
			}},
		}},
		Dictionary: d.tables,
	}
}

type dictionary struct {
	tables     *pb.ProfilesDictionary
	strings    map[string]int32
	functions  map[string]int32
	locations  map[string]int32
	stacks     map[string]int32
	links      map[string]int32
	attributes map[string]int32
}

func newDictionary() *dictionary {
	// Index 0 of every table is the zero value, which OTLP reads as "not set".
	return &dictionary{
		tables: &pb.ProfilesDictionary{
			MappingTable:   []*pb.Mapping{{}},
			LocationTable:  []*pb.Location{{}},
			FunctionTable:  []*pb.Function{{}},
			LinkTable:      []*pb.Link{{}},
			StringTable:    []string{""},
			AttributeTable: []*pb.KeyValueAndUnit{{}},
			StackTable:     []*pb.Stack{{}},
		},
		strings:    map[string]int32{"": 0},
		functions:  map[string]int32{},
		locations:  map[string]int32{},
		stacks:     map[string]int32{"": 0},
		links:      map[string]int32{},
		attributes: map[string]int32{},
	}
}

func (d *dictionary) str(s string) int32 {
	if i, ok := d.strings[s]; ok {
		return i
	}
	i := int32(len(d.tables.StringTable))
	d.tables.StringTable = append(d.tables.StringTable, s)
	d.strings[s] = i
	return i
}

func (d *dictionary) function(f *profile.Function) int32 {
	key := f.Name + "\x00" + f.Filename
	if i, ok := d.functions[key]; ok {
		return i
	}
	i := int32(len(d.tables.FunctionTable))
	d.tables.FunctionTable = append(d.tables.FunctionTable, &pb.Function{
		NameStrindex:       d.str(f.Name),
		SystemNameStrindex: d.str(f.SystemName),
		FilenameStrindex:   d.str(f.Filename),
		StartLine:          f.StartLine,
	})
	d.functions[key] = i
	return i
}

// location keys on the symbolized lines, not the address, so the same frame
// from the CPU and the heap profile collapses into one entry.
func (d *dictionary) location(l *profile.Location) int32 {
	lines := make([]*pb.Line, 0, len(l.Line))
	var key strings.Builder
	for _, line := range l.Line {
		var fn int32
		if line.Function != nil {
			fn = d.function(line.Function)
		}
		lines = append(lines, &pb.Line{FunctionIndex: fn, Line: line.Line, Column: line.Column})
		key.WriteString(strconv.Itoa(int(fn)) + ":" + strconv.FormatInt(line.Line, 10) + ",")
	}
	if i, ok := d.locations[key.String()]; ok {
		return i
	}
	i := int32(len(d.tables.LocationTable))
	d.tables.LocationTable = append(d.tables.LocationTable, &pb.Location{Lines: lines})
	d.locations[key.String()] = i
	return i
}

func (d *dictionary) stack(locations []int32) int32 {
	var key strings.Builder
	for _, l := range locations {
		key.WriteString(strconv.Itoa(int(l)) + ",")
	}
	if i, ok := d.stacks[key.String()]; ok {
		return i
	}
	i := int32(len(d.tables.StackTable))
	d.tables.StackTable = append(d.tables.StackTable, &pb.Stack{LocationIndices: locations})
	d.stacks[key.String()] = i
	return i
}

func (d *dictionary) link(traceID, spanID string) int32 {
	key := traceID + spanID
	if i, ok := d.links[key]; ok {
		return i
	}
	t, terr := hex.DecodeString(traceID)
	s, serr := hex.DecodeString(spanID)
	if terr != nil || serr != nil || len(t) != 16 || len(s) != 8 {
		return 0
	}
	i := int32(len(d.tables.LinkTable))
	d.tables.LinkTable = append(d.tables.LinkTable, &pb.Link{TraceId: t, SpanId: s})
	d.links[key] = i
	return i
}

func (d *dictionary) attribute(key, value string) int32 {
	k := key + "\x00" + value
	if i, ok := d.attributes[k]; ok {
		return i
	}
	i := int32(len(d.tables.AttributeTable))
	d.tables.AttributeTable = append(d.tables.AttributeTable, &pb.KeyValueAndUnit{
		KeyStrindex: d.str(key),
		Value:       &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: value}},
	})
	d.attributes[k] = i
	return i
}

type sample struct {
	stack      int32
	link       int32
	attributes []int32
	values     []int64
}

func (d *dictionary) convert(p *profile.Profile, w window) []*pb.Profile {
	locations := map[uint64]int32{}
	samples := make([]sample, 0, len(p.Sample))
	for _, s := range p.Sample {
		// pprof and OTLP both list a stack leaf first.
		stack := make([]int32, 0, len(s.Location))
		for _, l := range s.Location {
			i, ok := locations[l.ID]
			if !ok {
				i = d.location(l)
				locations[l.ID] = i
			}
			stack = append(stack, i)
		}
		samples = append(samples, sample{
			stack:      d.stack(stack),
			link:       d.sampleLink(s.Label),
			attributes: d.sampleAttributes(s.Label),
			values:     s.Value,
		})
	}

	var periodType *pb.ValueType
	if p.PeriodType != nil {
		periodType = &pb.ValueType{TypeStrindex: d.str(p.PeriodType.Type), UnitStrindex: d.str(p.PeriodType.Unit)}
	}

	var out []*pb.Profile
	for column, st := range p.SampleType {
		var typed []*pb.Sample
		for _, s := range samples {
			// A zero weight carries no signal; delta heap profiles are mostly zeros.
			if s.values[column] <= 0 {
				continue
			}
			typed = append(typed, &pb.Sample{
				StackIndex:       s.stack,
				LinkIndex:        s.link,
				AttributeIndices: s.attributes,
				Values:           []int64{s.values[column]},
			})
		}
		if len(typed) == 0 {
			continue
		}
		out = append(out, &pb.Profile{
			SampleType:   &pb.ValueType{TypeStrindex: d.str(st.Type), UnitStrindex: d.str(st.Unit)},
			Samples:      typed,
			TimeUnixNano: uint64(w.start.UnixNano()),
			DurationNano: uint64(w.duration.Nanoseconds()),
			PeriodType:   periodType,
			Period:       p.Period,
			ProfileId:    newProfileID(),
		})
	}
	return out
}

func (d *dictionary) sampleLink(labels map[string][]string) int32 {
	traceID, spanID := first(labels[traceIDLabel]), first(labels[spanIDLabel])
	if traceID == "" || spanID == "" {
		return 0
	}
	return d.link(traceID, spanID)
}

// sampleAttributes turns pprof labels, such as those set with pprof.Do, into
// sample attributes. The span labels become the sample's link instead.
func (d *dictionary) sampleAttributes(labels map[string][]string) []int32 {
	linked := first(labels[traceIDLabel]) != "" && first(labels[spanIDLabel]) != ""
	keys := make([]string, 0, len(labels))
	for k := range labels {
		if linked && (k == traceIDLabel || k == spanIDLabel) {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var out []int32
	for _, k := range keys {
		if v := first(labels[k]); v != "" {
			out = append(out, d.attribute(k, v))
		}
	}
	return out
}

func first(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func keyValues(attrs map[string]string) []*commonpb.KeyValue {
	keys := make([]string, 0, len(attrs))
	for k := range attrs {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]*commonpb.KeyValue, 0, len(keys))
	for _, k := range keys {
		out = append(out, &commonpb.KeyValue{
			Key:   k,
			Value: &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: attrs[k]}},
		})
	}
	return out
}

func newProfileID() []byte {
	id := make([]byte, 16)
	_, _ = rand.Read(id)
	return id
}
