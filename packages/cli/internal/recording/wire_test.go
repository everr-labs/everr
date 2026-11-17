package recording

import (
	"strings"
	"testing"
)

func TestReadWireReadsTheHeaderTheRowsAndTheEnd(t *testing.T) {
	w, err := readWire([]byte("{\"format\":1,\"read_ms\":5}\n{\"segment_index\":3,\"Body\":\"[]\",\"event_index\":\"\",\"piece\":\"\",\"pieces\":\"\"}\n{\"rows\":1}\n"))
	if err != nil {
		t.Fatal(err)
	}
	if w.readMs != 5 || len(w.rows) != 1 || w.rows[0].segmentIndex != 3 || w.rows[0].body != "[]" {
		t.Fatalf("wire = %+v", w)
	}
}

func TestReadWireRefusesABodyWithoutItsEndOrWithABrokenLine(t *testing.T) {
	for _, body := range []string{
		"{\"format\":1,\"read_ms\":5}\n",
		"{\"format\":1,\"read_ms\":5}\n{\"rows\":2}\n",
		"{\"format\":1,\"read_ms\":5}\n{\"segment_index\":0,\"Bo\n{\"rows\":1}\n",
		"{\"format\":1,\"read_ms\":5}\n{\"rows\":0}\n{\"rows\":0}\n",
	} {
		_, err := readWire([]byte(body))
		if err == nil || err.Error() != "The Recording read was cut short. Retry." {
			t.Errorf("%q: %v", body, err)
		}
	}
}

func TestReadWireAsksForAnUpgradeOnAFormatItDoesNotRead(t *testing.T) {
	_, err := readWire([]byte("{\"format\":2,\"read_ms\":5}\n{\"rows\":0}\n"))
	if err == nil || !strings.Contains(err.Error(), "Recording format 2") || !strings.Contains(err.Error(), " upgrade`") {
		t.Fatalf("err = %v", err)
	}
	for _, body := range []string{"<html>", `{"format":1}`, ""} {
		_, err = readWire([]byte(body))
		if err == nil || !strings.Contains(err.Error(), " upgrade`") {
			t.Errorf("%q: %v", body, err)
		}
	}
}
