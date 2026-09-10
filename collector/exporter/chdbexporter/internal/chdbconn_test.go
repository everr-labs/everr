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

func TestFormatTimestampReturnsRFC3339NanosInUTC(t *testing.T) {
	localTime := time.Date(2024, 3, 4, 5, 6, 7, 890123456, time.FixedZone("plus-two", 2*60*60))

	require.Equal(t, "2024-03-04T03:06:07.890123456Z", formatTimestamp(localTime))
}

// One encoding has to land correctly in every time column the templates
// use: nanoseconds for DateTime64(9), seconds for DateTime, and the
// Array(DateTime) form the metric exemplars use.
func TestFormatTimestampInsertsIntoEveryTimeColumnType(t *testing.T) {
	t.Cleanup(chdb.ResetForTesting)

	handle, err := chdb.Open(filepath.Join(t.TempDir(), "chdb"))
	require.NoError(t, err)

	localTime := time.Date(2024, 3, 4, 5, 6, 7, 890123456, time.FixedZone("plus-two", 2*60*60))
	encoded := formatTimestamp(localTime)
	row, err := json.Marshal(map[string]any{"nanos": encoded, "seconds": encoded, "list": []any{encoded}})
	require.NoError(t, err)

	var buf []byte
	err = handle.Do(t.Context(), func(_ context.Context, session chdb.Session) error {
		for _, query := range []string{
			"CREATE TABLE timestamp_insert_test (nanos DateTime64(9), seconds DateTime, list Array(DateTime)) ENGINE = Memory",
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
			"SELECT toString(toUnixTimestamp64Nano(nanos)) AS nanos, toString(toUnixTimestamp(seconds)) AS seconds, arrayMap(x -> toString(toUnixTimestamp(x)), list) AS list FROM timestamp_insert_test",
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
	require.JSONEq(t,
		fmt.Sprintf(`{"nanos":"%d","seconds":"%d","list":["%d"]}`, localTime.UnixNano(), localTime.Unix(), localTime.Unix()),
		string(bytes.TrimSpace(buf)))
}
