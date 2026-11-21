package chdbexporter

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/sqltemplates"
)

// The everr_fingerprint processor computes the same value in Go for new logs,
// while logs stored before it ran are still grouped by this UDF. Both sides
// are pinned to one fixture so an Error keeps its identity across the switch.
func TestErrorFingerprintUDFMatchesProcessorFixture(t *testing.T) {
	raw, err := os.ReadFile("../../processor/everrfingerprintprocessor/testdata/fingerprints.json")
	require.NoError(t, err)
	var cases []struct {
		ServiceName      string `json:"serviceName"`
		Fingerprint      string `json:"fingerprint"`
		ExceptionType    string `json:"exceptionType"`
		ExceptionMessage string `json:"exceptionMessage"`
		Expected         string `json:"expected"`
	}
	require.NoError(t, json.Unmarshal(raw, &cases))

	handle := openRealChDB(t)
	queryJSONRows(t, handle, sqltemplates.CreateErrorFingerprintFunction)
	for i, c := range cases {
		rows := queryJSONRows(t, handle, fmt.Sprintf(
			"SELECT errorFingerprint(%s, %s, %s, %s) AS fp",
			sqlString(c.ServiceName), sqlString(c.Fingerprint), sqlString(c.ExceptionType), sqlString(c.ExceptionMessage),
		))
		require.Len(t, rows, 1)
		require.Equal(t, c.Expected, rows[0]["fp"], "case %d: %q", i, c.ExceptionMessage)
	}
}

func sqlString(s string) string {
	return "'" + strings.NewReplacer(`\`, `\\`, `'`, `\'`).Replace(s) + "'"
}
