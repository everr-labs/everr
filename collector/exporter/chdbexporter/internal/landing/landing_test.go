package landing

import (
	"encoding/json"
	"math"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/chdbtest"
)

func TestSendWritesOneInsertWithEachValueEncodedByItsGoType(t *testing.T) {
	handle, session := chdbtest.Open(t)
	table := Table{Name: "otel.example", Columns: []string{"At", "Document", "Documents", "Map", "Text", "Times", "Empty", "Count", "Flag"}}
	newYork := time.FixedZone("EST", -5*60*60)
	at := time.Date(2026, 1, 2, 3, 4, 5, 123456789, newYork)

	batch := NewBatch(table)
	require.NoError(t, batch.Append(
		at,
		json.RawMessage(`{"n":3,"s":"x"}`),
		[]json.RawMessage{json.RawMessage(`{"a":true}`), json.RawMessage(`{}`)},
		map[string]string{"b": "2", "a": "1"},
		`{"not":"a document"}`,
		[]time.Time{at.UTC()},
		[]string(nil),
		uint64(18446744073709551615),
		true,
	))
	require.NoError(t, batch.Append(time.Unix(0, 0), json.RawMessage(`{}`), []json.RawMessage{}, map[string]string{}, "", []time.Time{}, []string{}, uint64(0), false))
	require.NoError(t, batch.Send(t.Context(), handle))

	require.Equal(t, []string{
		"INSERT INTO otel.example SETTINGS type_json_skip_duplicated_paths = 1 FORMAT JSONEachRow\n" +
			`{"At":"2026-01-02T08:04:05.123456789Z","Document":{"n":3,"s":"x"},"Documents":[{"a":true},{}],"Map":{"a":"1","b":"2"},"Text":"{\"not\":\"a document\"}","Times":["2026-01-02T08:04:05.123456789Z"],"Empty":null,"Count":18446744073709551615,"Flag":true}` + "\n" +
			`{"At":"1970-01-01T00:00:00Z","Document":{},"Documents":[],"Map":{},"Text":"","Times":[],"Empty":[],"Count":0,"Flag":false}` + "\n",
	}, session.Statements())
}

func TestSendWritesNonFiniteFloatsInTheSpellingFloat64ColumnsRead(t *testing.T) {
	handle, session := chdbtest.Open(t)
	batch := NewBatch(Table{Name: "otel.example", Columns: []string{"NaN", "Inf", "Bounds", "Finite"}})

	require.NoError(t, batch.Append(math.NaN(), math.Inf(1), []float64{1.5, math.Inf(-1)}, []float64{0.5}))
	require.NoError(t, batch.Send(t.Context(), handle))

	require.Equal(t, []string{"INSERT INTO otel.example SETTINGS type_json_skip_duplicated_paths = 1 FORMAT JSONEachRow\n" +
		`{"NaN":"nan","Inf":"inf","Bounds":[1.5,"-inf"],"Finite":[0.5]}` + "\n"}, session.Statements())
}

func TestAppendRejectsARowThatDoesNotMatchTheColumns(t *testing.T) {
	handle, session := chdbtest.Open(t)
	batch := NewBatch(Table{Name: "otel.example", Columns: []string{"A", "B"}})

	require.Error(t, batch.Append("only one"))
	require.Error(t, batch.Append("a", func() {}), "a value JSON cannot hold")
	require.NoError(t, batch.Append("a", "b"))
	require.NoError(t, batch.Send(t.Context(), handle))

	require.Equal(t, []string{"INSERT INTO otel.example SETTINGS type_json_skip_duplicated_paths = 1 FORMAT JSONEachRow\n" + `{"A":"a","B":"b"}` + "\n"}, session.Statements(),
		"a rejected row leaves nothing behind")
}

func TestSendWithoutRowsSendsNothingAndAChDBErrorComesBack(t *testing.T) {
	handle, session := chdbtest.Open(t)

	require.NoError(t, NewBatch(Logs).Send(t.Context(), handle))
	require.Empty(t, session.Statements())

	session.Fail = true
	batch := NewBatch(Table{Name: "otel.example", Columns: []string{"A"}})
	require.NoError(t, batch.Append(1))
	require.ErrorContains(t, batch.Send(t.Context(), handle), "chDB says no")
}
