// Package banner prints the Everr logo and wordmark.
package banner

import (
	"fmt"
	"os"
	"regexp"
	"strings"
	"unicode/utf8"

	"golang.org/x/term"
)

// Braille rendition of packages/ui/src/assets/favicon.svg.
var logoLines = []string{
	"     ⣠⣤⣤⡀",
	"     ⣿⡿⢿⠇   \x1b[38;2;215;255;0m⣶\x1b[0m",
	"    ⢀⣀⣸⣧⣤⣀⡀\x1b[38;2;215;255;0m⠘⠃⢀⣠⡤\x1b[0m",
	"  ⣠⣾⣿⠿⠛⠛⠛⠛⠛⠷⣄\x1b[38;2;215;255;0m⠉⠁\x1b[0m",
	" ⢸⣿⣿⠃ \x1b[38;2;215;255;0m⢀\x1b[0m   \x1b[38;2;215;255;0m⢀\x1b[0m ⠘⣇",
	"⣼⡇⣿⣏  \x1b[38;2;215;255;0m⢿⠇\x1b[0m  \x1b[38;2;215;255;0m⢿⠇\x1b[0m ⣿",
	"⠘⠣⣿⣿⣄      ⢀⣠⠏",
	"  ⠉⠛⠛⠛⠛⠛⠛⠛⠛⠛⠁",
}

var wordmarkLines = []string{
	" ░███████  ░██    ░██  ░███████  ░██░████ ░██░████",
	"░██    ░██ ░██    ░██ ░██    ░██ ░███     ░███",
	"░█████████  ░██  ░██  ░█████████ ░██      ░██",
	"░██          ░██░██   ░██        ░██      ░██",
	" ░███████     ░███     ░███████  ░██      ░██",
}

const logoColumnWidth = 16

var ansiEscape = regexp.MustCompile("\x1b\\[[0-9;]*m")

func shouldUseColor() bool {
	if !term.IsTerminal(int(os.Stdout.Fd())) {
		return false
	}
	if _, ok := os.LookupEnv("NO_COLOR"); ok {
		return false
	}
	return os.Getenv("TERM") != "dumb"
}

// PrintBanner prints the banner to stdout, colored when stdout is a terminal.
func PrintBanner() {
	fmt.Println()
	fmt.Print(render(shouldUseColor()))
	fmt.Println("\nObservability made simple.")
	fmt.Println()
}

func render(useColor bool) string {
	var banner strings.Builder
	total := max(len(logoLines), len(wordmarkLines))
	wordmarkOffset := (total - len(wordmarkLines) + 1) / 2
	for i := range total {
		logo := ""
		if i < len(logoLines) {
			logo = logoLines[i]
		}
		if !useColor {
			logo = ansiEscape.ReplaceAllString(logo, "")
		}
		wordmark := ""
		if j := i - wordmarkOffset; j >= 0 && j < len(wordmarkLines) {
			wordmark = wordmarkLines[j]
		}
		if wordmark == "" {
			fmt.Fprintln(&banner, logo)
			continue
		}
		width := utf8.RuneCountInString(ansiEscape.ReplaceAllString(logo, ""))
		fmt.Fprintf(&banner, "%s%s   %s\n", logo, strings.Repeat(" ", logoColumnWidth-width), wordmark)
	}
	return banner.String()
}
