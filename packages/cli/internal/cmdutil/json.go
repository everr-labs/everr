package cmdutil

import (
	"encoding/json"
	"io"
)

// PrintJSON writes value as indented JSON without HTML escaping, the way the
// previous CLI's serde_json output read.
func PrintJSON(w io.Writer, value any) error {
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}
