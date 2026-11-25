// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter // import "github.com/everr-labs/everr/collector/exporter/chdbexporter"

import (
	"context"
	"fmt"

	"github.com/cespare/xxhash/v2"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/pprofile"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal"
	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/landing"
	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

// The conversion is upstream clickhouseexporter v0.165.1's
// exporter_profiles.go, so a local store holds the same rows as a hosted one.
// Only the destination differs: one landing batch instead of a clickhouse-go
// batch, with the retention stamp the views require.
type profilesExporter struct {
	handle        *chdb.Handle
	retentionDays string
}

func (e *profilesExporter) pushProfilesData(ctx context.Context, pd pprofile.Profiles) error {
	batch := landing.NewBatch(landing.Profiles)

	dic := pd.Dictionary()
	stringTable := dic.StringTable()

	rps := pd.ResourceProfiles()
	for i := range rps.Len() {
		rp := rps.At(i)
		resAttr := rp.Resource().Attributes()
		stampRetention(resAttr, e.retentionDays)
		serviceName := internal.GetServiceName(resAttr)
		resAttrMap := attributesToMap(resAttr)

		sps := rp.ScopeProfiles()
		for j := range sps.Len() {
			sp := sps.At(j)
			scope := sp.Scope()

			profiles := sp.Profiles()
			for k := range profiles.Len() {
				profile := profiles.At(k)

				profileAttrs, err := pprofile.FromAttributeIndices(dic.AttributeTable(), profile, dic)
				if err != nil {
					return fmt.Errorf("failed to resolve profile attributes: %w", err)
				}
				profileAttrMap := attributesToMap(profileAttrs)

				samples := profile.Samples()
				for s := range samples.Len() {
					sample := samples.At(s)

					frames := resolveStack(dic, sample.StackIndex())
					traceID, spanID := resolveLink(dic, sample.LinkIndex())
					sampleAttrs, err := pprofile.FromAttributeIndices(dic.AttributeTable(), sample, dic)
					if err != nil {
						return fmt.Errorf("failed to resolve sample attributes: %w", err)
					}

					appendErr := batch.Append(
						profile.Time().AsTime(),
						profile.ProfileID().String(),
						stringAt(stringTable, profile.SampleType().TypeStrindex()),
						stringAt(stringTable, profile.SampleType().UnitStrindex()),
						serviceName,
						resAttrMap,
						scope.Name(),
						scope.Version(),
						profileAttrMap,
						attributesToMap(sampleAttrs),
						frames.hash,
						frames.addresses,
						frames.functionNames,
						frames.fileNames,
						frames.lineNumbers,
						frames.mappingFileNames,
						sample.Values().AsRaw(),
						sample.TimestampsUnixNano().AsRaw(),
						profile.DurationNano(),
						profile.Period(),
						stringAt(stringTable, profile.PeriodType().TypeStrindex()),
						stringAt(stringTable, profile.PeriodType().UnitStrindex()),
						traceID,
						spanID,
					)
					if appendErr != nil {
						return fmt.Errorf("failed to append profile sample row: %w", appendErr)
					}
				}
			}
		}
	}

	if sendErr := batch.Send(ctx, e.handle); sendErr != nil {
		return fmt.Errorf("profiles insert failed: %w", sendErr)
	}
	return nil
}

// The profiles attribute columns are Map(String, String), not JSON: every
// value is written as its string form, as upstream's AttributesToMap does.
func attributesToMap(attrs pcommon.Map) map[string]string {
	m := make(map[string]string, attrs.Len())
	for k, v := range attrs.All() {
		m[k] = v.AsString()
	}
	return m
}

type resolvedStack struct {
	hash             uint64
	addresses        []uint64
	functionNames    []string
	fileNames        []string
	lineNumbers      []int32
	mappingFileNames []string
}

func resolveStack(dic pprofile.ProfilesDictionary, stackIndex int32) resolvedStack {
	var rs resolvedStack
	stackTable := dic.StackTable()
	if stackIndex < 0 || int(stackIndex) >= stackTable.Len() {
		return rs
	}

	stringTable := dic.StringTable()
	locationTable := dic.LocationTable()
	functionTable := dic.FunctionTable()
	mappingTable := dic.MappingTable()
	hash := xxhash.New()

	locationIndices := stackTable.At(int(stackIndex)).LocationIndices()
	for li := range locationIndices.Len() {
		locIdx := locationIndices.At(li)
		if int(locIdx) >= locationTable.Len() {
			continue
		}

		location := locationTable.At(int(locIdx))
		address := location.Address()

		mappingFile := ""
		if int(location.MappingIndex()) < mappingTable.Len() {
			mappingFile = stringAt(stringTable, mappingTable.At(int(location.MappingIndex())).FilenameStrindex())
		}

		lines := location.Lines()
		if lines.Len() == 0 {
			rs.appendFrame(hash, address, "", "", 0, mappingFile)
			continue
		}

		for ln := range lines.Len() {
			line := lines.At(ln)
			functionName := ""
			fileName := ""
			if int(line.FunctionIndex()) < functionTable.Len() {
				fn := functionTable.At(int(line.FunctionIndex()))
				functionName = stringAt(stringTable, fn.NameStrindex())
				fileName = stringAt(stringTable, fn.FilenameStrindex())
			}

			rs.appendFrame(hash, address, functionName, fileName, int32(line.Line()), mappingFile)
		}
	}

	rs.hash = hash.Sum64()
	return rs
}

func (rs *resolvedStack) appendFrame(hash *xxhash.Digest, address uint64, functionName, fileName string, lineNumber int32, mappingFile string) {
	rs.addresses = append(rs.addresses, address)
	rs.functionNames = append(rs.functionNames, functionName)
	rs.fileNames = append(rs.fileNames, fileName)
	rs.lineNumbers = append(rs.lineNumbers, lineNumber)
	rs.mappingFileNames = append(rs.mappingFileNames, mappingFile)

	_, _ = hash.WriteString(functionName)
	_, _ = hash.Write([]byte{0})
	_, _ = hash.WriteString(fileName)
	_, _ = hash.Write([]byte{0})
}

// Link 0 is the dictionary's empty link, so a sample that points at it has no
// span. An empty ID is written as an empty string.
func resolveLink(dic pprofile.ProfilesDictionary, linkIndex int32) (traceID, spanID string) {
	linkTable := dic.LinkTable()
	if linkIndex <= 0 || int(linkIndex) >= linkTable.Len() {
		return "", ""
	}

	link := linkTable.At(int(linkIndex))
	return link.TraceID().String(), link.SpanID().String()
}

func stringAt(table pcommon.StringSlice, index int32) string {
	if index < 0 || int(index) >= table.Len() {
		return ""
	}
	return table.At(int(index))
}
