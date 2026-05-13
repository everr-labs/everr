// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package internal

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
	"github.com/stretchr/testify/require"
)

func TestNormalizeJSONValuePreservesRawJSONBytes(t *testing.T) {
	encoded, err := json.Marshal(map[string]any{
		"attrs": normalizeJSONValue([]byte(`{"answer":42,"nested":{"enabled":true}}`)),
	})

	require.NoError(t, err)
	require.JSONEq(t, `{"attrs":{"answer":42,"nested":{"enabled":true}}}`, string(encoded))
	require.NotContains(t, string(encoded), "[123,34")
}

func TestNormalizeJSONValuePreservesRawMessage(t *testing.T) {
	encoded, err := json.Marshal(map[string]any{
		"attrs": normalizeJSONValue(json.RawMessage(`["first","second"]`)),
	})

	require.NoError(t, err)
	require.JSONEq(t, `{"attrs":["first","second"]}`, string(encoded))
}

func TestFormatTimestampReturnsUnixNanos(t *testing.T) {
	localTime := time.Date(2024, 3, 4, 5, 6, 7, 890123456, time.FixedZone("plus-two", 2*60*60))

	require.Equal(t, localTime.UTC().UnixNano(), formatTimestamp(localTime))
}

func TestFormatTimestampInsertsAsUTCInChDBJSONEachRow(t *testing.T) {
	t.Cleanup(chdb.ResetForTesting)

	handle, err := chdb.Open(filepath.Join(t.TempDir(), "chdb"))
	require.NoError(t, err)

	localTime := time.Date(2024, 3, 4, 5, 6, 7, 890123456, time.FixedZone("plus-two", 2*60*60))
	row, err := json.Marshal(map[string]any{"ts": formatTimestamp(localTime)})
	require.NoError(t, err)

	var buf []byte
	err = handle.Do(t.Context(), func(_ context.Context, session chdb.Session) error {
		for _, query := range []string{
			"CREATE TABLE timestamp_insert_test (ts DateTime64(9)) ENGINE = Memory",
			"INSERT INTO timestamp_insert_test FORMAT JSONEachRow\n" + string(row) + "\n",
		} {
			result, err := session.Query(query, "")
			if err != nil {
				return err
			}
			if result != nil {
				result.Free()
			}
		}

		result, err := session.Query(
			"SELECT toString(toUnixTimestamp64Nano(ts)) AS nanos FROM timestamp_insert_test",
			"JSONEachRow",
		)
		if err != nil {
			return err
		}
		if result == nil {
			return nil
		}
		defer result.Free()
		buf = append(buf, result.Buf()...)
		return nil
	})

	require.NoError(t, err)
	require.JSONEq(t, fmt.Sprintf(`{"nanos":"%d"}`, localTime.UTC().UnixNano()), string(bytes.TrimSpace(buf)))
}
