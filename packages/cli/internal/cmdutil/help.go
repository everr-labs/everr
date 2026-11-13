package cmdutil

import (
	"fmt"
	"io"
	"strings"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// The help layout follows the previous clap-based CLI so docs, skills, and
// agents that read `--help` keep working.

// RootName is the program name shown in help, whichever binary name runs.
const RootName = "everr"

// RenderHelp writes cmd's help.
func RenderHelp(w io.Writer, cmd *cobra.Command) {
	about := cmd.Long
	if about == "" {
		about = cmd.Short
	}
	if about != "" {
		fmt.Fprintf(w, "%s\n\n", about)
	}
	fmt.Fprintf(w, "Usage: %s\n", UsageLine(cmd))

	if subs := visibleSubcommands(cmd); len(subs) > 0 {
		rows := make([][2]string, 0, len(subs)+1)
		for _, sub := range subs {
			rows = append(rows, [2]string{sub.Name(), sub.Short})
		}
		rows = append(rows, [2]string{"help", "Print this message or the help of the given subcommand(s)"})
		fmt.Fprint(w, "\nCommands:\n")
		writeRows(w, rows)
	}

	if args := positionals[cmd]; len(args) > 0 {
		rows := make([][2]string, 0, len(args))
		for _, arg := range args {
			rows = append(rows, [2]string{arg.usage(), arg.Help})
		}
		fmt.Fprint(w, "\nArguments:\n")
		writeRows(w, rows)
	}

	fmt.Fprint(w, "\nOptions:\n")
	writeRows(w, flagRows(cmd))
}

// UsageLine is cmd's "everr local query [OPTIONS] <SQL>" usage.
func UsageLine(cmd *cobra.Command) string {
	parts := []string{commandPath(cmd)}
	if hasOptions(cmd) {
		parts = append(parts, "[OPTIONS]")
	}
	for _, arg := range positionals[cmd] {
		parts = append(parts, arg.usage())
	}
	if len(visibleSubcommands(cmd)) > 0 {
		parts = append(parts, "<COMMAND>")
	}
	return strings.Join(parts, " ")
}

func commandPath(cmd *cobra.Command) string {
	path := cmd.CommandPath()
	if root := cmd.Root(); root != nil {
		path = RootName + strings.TrimPrefix(path, root.Name())
	}
	return path
}

func visibleSubcommands(cmd *cobra.Command) []*cobra.Command {
	var subs []*cobra.Command
	for _, sub := range cmd.Commands() {
		if sub.Hidden || sub.Name() == "help" {
			continue
		}
		subs = append(subs, sub)
	}
	return subs
}

func hasOptions(cmd *cobra.Command) bool {
	found := false
	cmd.LocalFlags().VisitAll(func(flag *pflag.Flag) {
		if !flag.Hidden && flag.Name != "help" && flag.Name != "version" {
			found = true
		}
	})
	return found
}

func flagRows(cmd *cobra.Command) [][2]string {
	var rows [][2]string
	var help, version *pflag.Flag
	cmd.LocalFlags().VisitAll(func(flag *pflag.Flag) {
		switch {
		case flag.Hidden:
		case flag.Name == "help":
			help = flag
		case flag.Name == "version":
			version = flag
		default:
			rows = append(rows, [2]string{flagSpec(flag), flagHelp(flag)})
		}
	})
	if help != nil {
		rows = append(rows, [2]string{flagSpec(help), "Print help"})
	}
	if version != nil {
		rows = append(rows, [2]string{flagSpec(version), "Print version"})
	}
	return rows
}

func flagSpec(flag *pflag.Flag) string {
	spec := "    "
	if flag.Shorthand != "" {
		spec = "-" + flag.Shorthand + ", "
	}
	spec += "--" + flag.Name
	if takesValue(flag) {
		if flag.NoOptDefVal != "" || flag.Annotations[annotationOptionalValue] != nil {
			spec += " [<" + valueName(flag) + ">]"
		} else {
			spec += " <" + valueName(flag) + ">"
		}
	}
	return spec
}

func flagHelp(flag *pflag.Flag) string {
	help := flag.Usage
	if flag.Annotations[annotationShowDefault] != nil {
		help += fmt.Sprintf(" [default: %s]", flag.DefValue)
	}
	if possible := flag.Annotations[annotationPossible]; len(possible) > 0 {
		help += fmt.Sprintf(" [possible values: %s]", possible[0])
	}
	return strings.TrimSpace(help)
}

func writeRows(w io.Writer, rows [][2]string) {
	width := 0
	for _, row := range rows {
		width = max(width, len(row[0]))
	}
	for _, row := range rows {
		if row[1] == "" {
			fmt.Fprintf(w, "  %s\n", row[0])
			continue
		}
		fmt.Fprintf(w, "  %-*s  %s\n", width, row[0], row[1])
	}
}
