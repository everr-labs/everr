package resources

import (
	"strings"
	"testing"
)

func TestShowPrintsDocumentsAsBlockYAMLWithSortedKeys(t *testing.T) {
	document, err := decodeJSON([]byte(`{"spec":{"layouts":[],"panels":{},"tags":["a","b"],"items":[{"z":1,"a":1.5}]},` +
		`"kind":"Dashboard","note":"line 1\nline 2","flag":"true","none":null,"big":18446744073709551615}`))
	if err != nil {
		t.Fatal(err)
	}
	var out strings.Builder
	if err := printYAML(&out, document); err != nil {
		t.Fatal(err)
	}
	want := `big: 18446744073709551615
flag: "true"
kind: Dashboard
none: null
note: |-
  line 1
  line 2
spec:
  items:
  - a: 1.5
    z: 1
  layouts: []
  panels: {}
  tags:
  - a
  - b
`
	if out.String() != want {
		t.Errorf("yaml:\n%s\nwant:\n%s", out.String(), want)
	}
}
