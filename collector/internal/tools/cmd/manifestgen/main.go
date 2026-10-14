package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"go.yaml.in/yaml/v3"
)

func main() {
	if len(os.Args) != 6 {
		fatal("usage: manifestgen common.yaml additions.yaml output.yaml output-path debug-compilation")
	}

	common, err := readManifest(os.Args[1])
	if err != nil {
		fatal("read common manifest: %v", err)
	}
	additions, err := readManifest(os.Args[2])
	if err != nil {
		fatal("read additions manifest: %v", err)
	}
	for key, value := range additions {
		additionalItems, ok := value.([]any)
		if !ok {
			fatal("manifest section %q must be a list", key)
		}
		if len(additionalItems) == 0 {
			continue
		}
		commonItems, ok := common[key].([]any)
		if !ok {
			if _, exists := common[key]; exists {
				fatal("common manifest section %q must be a list", key)
			}
			commonItems = nil
		}
		common[key] = append(commonItems, additionalItems...)
	}
	moduleRoot, err := filepath.Abs("../..")
	if err != nil {
		fatal("resolve collector directory: %v", err)
	}
	manifestDir, err := filepath.Abs(filepath.Dir(os.Args[1]))
	if err != nil {
		fatal("resolve manifest directory: %v", err)
	}
	outputDir := os.Args[4]
	if !filepath.IsAbs(outputDir) {
		outputDir = filepath.Join(moduleRoot, outputDir)
	}
	dist, ok := common["dist"].(map[string]any)
	if !ok {
		fatal("common manifest dist section must be a map")
	}
	dist["output_path"] = filepath.ToSlash(os.Args[4])
	debugCompilation, err := strconv.ParseBool(os.Args[5])
	if err != nil {
		fatal("parse debug-compilation: %v", err)
	}
	dist["debug_compilation"] = debugCompilation
	replacements, ok := common["replaces"].([]any)
	if !ok {
		fatal("common manifest replaces section must be a list")
	}
	for i, replacement := range replacements {
		value, ok := replacement.(string)
		if !ok {
			fatal("replace entry %d must be a string", i)
		}
		replacements[i] = relativizeReplacement(value, manifestDir, outputDir)
	}

	data, err := yaml.Marshal(common)
	if err != nil {
		fatal("encode manifest: %v", err)
	}
	if err := os.WriteFile(os.Args[3], data, 0o600); err != nil {
		fatal("write manifest: %v", err)
	}
}

func relativizeReplacement(value, manifestDir, outputDir string) string {
	parts := strings.SplitN(value, " => ", 2)
	if len(parts) != 2 || filepath.IsAbs(parts[1]) {
		return value
	}
	sourcePath := filepath.Clean(filepath.Join(manifestDir, parts[1]))
	relativePath, err := filepath.Rel(outputDir, sourcePath)
	if err != nil {
		fatal("resolve local replacement %q: %v", value, err)
	}
	return parts[0] + " => " + filepath.ToSlash(relativePath)
}

func readManifest(path string) (map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return map[string]any{}, nil
	}
	var manifest map[string]any
	if err := yaml.Unmarshal(data, &manifest); err != nil {
		return nil, err
	}
	if manifest == nil {
		return nil, fmt.Errorf("manifest is empty")
	}
	return manifest, nil
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
