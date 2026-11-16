// Package everrcli exposes the CLI's package.json so the Go build shares the
// version that release tooling bumps.
package everrcli

import (
	_ "embed"
	"encoding/json"
)

//go:embed package.json
var packageJSON []byte

// Version is the CLI version from package.json.
var Version = func() string {
	var pkg struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(packageJSON, &pkg); err != nil || pkg.Version == "" {
		panic("package.json has no version")
	}
	return pkg.Version
}()
