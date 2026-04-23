package main

import (
	"fmt"
	"strings"
)

// Column is one row from DESCRIBE TABLE FORMAT JSONEachRow.
// The generator only needs the name and type fields.
type Column struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

func RenderTable(name string, cols []Column) string {
	var b strings.Builder
	fmt.Fprintf(&b, "## %s\n\n| column | type |\n|---|---|\n", name)
	for _, col := range cols {
		fmt.Fprintf(&b, "| %s | %s |\n", col.Name, col.Type)
	}
	return b.String()
}
