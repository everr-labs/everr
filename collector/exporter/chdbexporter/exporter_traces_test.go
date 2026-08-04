// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter

import (
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

func TestClampedSpanDuration(t *testing.T) {
	span := ptrace.NewSpan()
	span.SetStartTimestamp(pcommon.Timestamp(1_000_000))
	span.SetEndTimestamp(pcommon.Timestamp(1_500_000))
	require.Equal(t, uint64(500_000), clampedSpanDuration(span))

	// A producer with a non-monotonic clock can stamp end before start; the
	// raw uint64 subtraction would wrap to ~2^64.
	span.SetEndTimestamp(pcommon.Timestamp(900_000))
	require.Equal(t, uint64(0), clampedSpanDuration(span))
}
