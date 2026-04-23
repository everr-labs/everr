// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package internal // import "github.com/everr-labs/chdbexporter/internal"

import (
	"slices"
	"strings"

	"go.opentelemetry.io/collector/pdata/pcommon"
	conventions "go.opentelemetry.io/otel/semconv/v1.38.0"
)

func GetServiceName(resAttr pcommon.Map) string {
	if v, ok := resAttr.Get(string(conventions.ServiceNameKey)); ok {
		return v.AsString()
	}

	return ""
}

func AttributesToMap(attributes pcommon.Map) map[string]string {
	if attributes.Len() == 0 {
		return map[string]string{}
	}

	values := make(map[string]string, attributes.Len())
	attributes.Range(func(k string, v pcommon.Value) bool {
		values[k] = v.AsString()
		return true
	})
	return values
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
