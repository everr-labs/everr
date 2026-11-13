// Package query parses and renders SQL query results shared by
// `everr cloud query` and `everr local query`.
package query

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"slices"
	"strings"

	"github.com/spf13/cobra"
	"golang.org/x/term"

	"github.com/everr-labs/everr/packages/cli/internal/cmdutil"
)

// Rows are decoded NDJSON rows. Numbers keep their original digits.
type Rows []any

func ParseNDJSON(body string) (Rows, error) {
	rows := Rows{}
	for line := range strings.Lines(body) {
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			continue
		}
		dec := json.NewDecoder(strings.NewReader(line))
		dec.UseNumber()
		var value any
		if err := dec.Decode(&value); err != nil {
			return nil, fmt.Errorf("parse row: %s: %w", line, err)
		}
		rows = append(rows, value)
	}
	return rows, nil
}

const (
	FormatJSON   = "json"
	FormatNDJSON = "ndjson"
	FormatTable  = "table"
)

// Args are the arguments shared by the query commands.
type Args struct {
	SQL    string
	format func() string
}

// Format is the chosen output format: --format, else table on a terminal and
// NDJSON otherwise.
func (a *Args) Format() string {
	if format := a.format(); format != "" {
		return format
	}
	if term.IsTerminal(int(os.Stdout.Fd())) {
		return FormatTable
	}
	return FormatNDJSON
}

// Bind declares the `<SQL>` argument and --format on cmd. Args.SQL is set
// when cmd runs.
func Bind(cmd *cobra.Command) *Args {
	args := &Args{}
	cmdutil.Positionals(cmd, cmdutil.Arg{Name: "SQL", Help: "SQL query to run. Keep it quoted and include LIMIT yourself."})
	args.format = cmdutil.Enum(cmd, "format", "Output format. Default: table on a TTY, ndjson otherwise.", FormatJSON, FormatNDJSON, FormatTable)
	cmdutil.SetHumanStdout(cmd, func(stdoutIsTerminal bool) bool {
		switch args.format() {
		case FormatTable:
			return true
		case FormatJSON, FormatNDJSON:
			return false
		}
		return stdoutIsTerminal
	})
	cmd.PreRun = func(_ *cobra.Command, positional []string) {
		args.SQL = positional[0]
	}
	return args
}

// Render writes rows to w in format.
func Render(w io.Writer, rows Rows, format string) error {
	switch format {
	case FormatNDJSON:
		for _, row := range rows {
			line, err := marshal(row, "")
			if err != nil {
				return err
			}
			fmt.Fprintln(w, line)
		}
	case FormatJSON:
		out, err := marshal([]any(rows), "  ")
		if err != nil {
			return err
		}
		fmt.Fprintln(w, out)
	default:
		renderTable(w, rows)
	}
	return nil
}

func renderTable(w io.Writer, rows Rows) {
	if len(rows) == 0 {
		fmt.Fprintln(w, "(no rows)")
		return
	}
	first, ok := rows[0].(map[string]any)
	if !ok {
		fmt.Fprintln(w, "(rows are not objects)")
		return
	}
	cols := make([]string, 0, len(first))
	for key := range first {
		cols = append(cols, key)
	}
	slices.Sort(cols)
	fmt.Fprintln(w, strings.Join(cols, " | "))
	for _, row := range rows {
		object, _ := row.(map[string]any)
		cells := make([]string, len(cols))
		for i, col := range cols {
			if value, ok := object[col]; ok {
				cells[i] = cell(value)
			}
		}
		fmt.Fprintln(w, strings.Join(cells, " | "))
	}
}

func cell(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	}
	out, _ := marshal(value, "")
	return out
}

// marshal encodes like serde_json: sorted keys and no HTML escaping.
func marshal(value any, indent string) (string, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", indent)
	if err := enc.Encode(value); err != nil {
		return "", err
	}
	return strings.TrimRight(buf.String(), "\n"), nil
}
