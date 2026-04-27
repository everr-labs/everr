package clickhouseexporter

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/everr-labs/chdbexporter/chdbhandle"
)

func countRows(t *testing.T, handle *chdbhandle.Handle, table string) uint64 {
	t.Helper()

	var count uint64
	err := handle.Do(context.Background(), func(_ context.Context, s chdbhandle.Session) error {
		result, err := s.Query(`SELECT count() FROM "`+table+`"`, "JSONEachRow")
		if err != nil {
			return err
		}
		defer result.Free()

		var row struct {
			Count uint64 `json:"count()"`
		}
		if err := json.Unmarshal(result.Buf(), &row); err != nil {
			return err
		}
		count = row.Count
		return nil
	})
	if err != nil {
		t.Fatalf("count rows in %s: %v", table, err)
	}

	return count
}
