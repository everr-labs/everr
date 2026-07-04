// Copyright 2026 Giordano Ricci (operating as "Everr Labs")
// SPDX-License-Identifier: Apache-2.0

package githubactionsreceiver

import (
	"encoding/hex"
	"testing"

	"github.com/stretchr/testify/require"
)

// These vectors are shared with the desktop build scripts, which derive the
// same ids to attach build-phase spans to workflow traces. Keep them in sync
// with packages/desktop-app/scripts/build-telemetry.test.ts; a change to the
// derivation on either side must fail that side's suite.
func TestBuildTelemetrySharedVectors(t *testing.T) {
	traceID, err := generateTraceID(123456, 9876543210, 1)
	require.NoError(t, err)
	require.Equal(t, "ce3e4cc4a1ed6e03e580b6b9174acdbf", hex.EncodeToString(traceID[:]))

	rootSpanID, err := generateParentSpanID(9876543210, 1)
	require.NoError(t, err)
	require.Equal(t, "00e6b232dd4f2fd7", hex.EncodeToString(rootSpanID[:]))

	jobSpanID, err := generateJobSpanID(9876543210, 1, "Build, Sign, Notarize Desktop")
	require.NoError(t, err)
	require.Equal(t, "fb1a2fcb5d794586", hex.EncodeToString(jobSpanID[:]))
}
