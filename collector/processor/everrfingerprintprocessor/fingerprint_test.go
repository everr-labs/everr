package everrfingerprintprocessor

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

// testdata/fingerprints.json holds what the errorFingerprint ClickHouse UDF
// returns; the chdbexporter tests check the UDF against the same file.
func TestErrorFingerprintMatchesClickHouseUDF(t *testing.T) {
	raw, err := os.ReadFile("testdata/fingerprints.json")
	require.NoError(t, err)
	var cases []struct {
		ServiceName      string `json:"serviceName"`
		Fingerprint      string `json:"fingerprint"`
		ExceptionType    string `json:"exceptionType"`
		ExceptionMessage string `json:"exceptionMessage"`
		Expected         string `json:"expected"`
	}
	require.NoError(t, json.Unmarshal(raw, &cases))
	require.NotEmpty(t, cases)
	for i, c := range cases {
		require.Equal(t, c.Expected, errorFingerprint(c.ServiceName, c.Fingerprint, c.ExceptionType, c.ExceptionMessage),
			"case %d: %q", i, c.ExceptionMessage)
	}
}
