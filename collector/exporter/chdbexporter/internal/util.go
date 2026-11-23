// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package internal // import "github.com/everr-labs/everr/collector/exporter/chdbexporter/internal"

import (
	"encoding/json"
	"math"
	"slices"
	"strconv"
	"strings"

	"go.opentelemetry.io/collector/pdata/pcommon"
	conventions "go.opentelemetry.io/otel/semconv/v1.43.0"
)

func GetServiceName(resAttr pcommon.Map) string {
	if v, ok := resAttr.Get(string(conventions.ServiceNameKey)); ok {
		return v.AsString()
	}

	return ""
}

// AttributesJSON is the document a JSON attribute column stores. A NaN or
// infinite double becomes the string "NaN", "+Inf" or "-Inf": encoding/json
// refuses those values and a JSON column cannot hold them as numbers.
func AttributesJSON(m pcommon.Map) (json.RawMessage, error) {
	return json.Marshal(quoteNonFinite(m.AsRaw()))
}

func quoteNonFinite(value any) any {
	switch v := value.(type) {
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return strconv.FormatFloat(v, 'g', -1, 64)
		}
	case map[string]any:
		for key, item := range v {
			v[key] = quoteNonFinite(item)
		}
	case []any:
		for i, item := range v {
			v[i] = quoteNonFinite(item)
		}
	}
	return value
}

// UniqueFlattenedAttributes converts a pcommon.Map into a slice of attributes. Paths are flattened and sorted.
func UniqueFlattenedAttributes(m pcommon.Map) []string {
	mLen := m.Len()
	if mLen == 0 {
		return nil
	}

	pathsSet := make(map[string]struct{}, mLen)
	paths := make([]string, 0, mLen)

	uniqueFlattenedAttributesNested("", &pathsSet, &paths, m)
	slices.Sort(paths)

	return paths
}

func uniqueFlattenedAttributesNested(pathPrefix string, pathsSet *map[string]struct{}, paths *[]string, m pcommon.Map) {
	m.Range(func(path string, v pcommon.Value) bool {
		if pathPrefix != "" {
			var b strings.Builder
			b.WriteString(pathPrefix)
			b.WriteRune('.')
			b.WriteString(path)
			path = b.String()
		}

		if v.Type() == pcommon.ValueTypeMap {
			uniqueFlattenedAttributesNested(path, pathsSet, paths, v.Map())
		} else if _, ok := (*pathsSet)[path]; !ok {
			(*pathsSet)[path] = struct{}{}
			*paths = append(*paths, path)
		}

		return true
	})
}
