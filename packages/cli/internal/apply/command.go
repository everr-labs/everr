package apply

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
	"github.com/spf13/cobra"
	"golang.org/x/term"

	"github.com/everr-labs/everr/packages/cli/internal/api"
	"github.com/everr-labs/everr/packages/cli/internal/auth"
	"github.com/everr-labs/everr/packages/cli/internal/cmdutil"
)

type options struct {
	dir     string
	dryRun  bool
	yes     bool
	preview *cmdutil.OptionalString
	adopt   bool
}

// NewCommand builds `everr apply`.
func NewCommand() *cobra.Command {
	opts := &options{}
	cmd := &cobra.Command{
		Use:   "apply",
		Short: "Reconcile a directory of as-code resources with Everr",
		RunE: func(cmd *cobra.Command, args []string) error {
			opts.dir = args[0]
			client, err := auth.NewClient(true)
			if err != nil {
				return err
			}
			return run(cmd.Context(), cmd.OutOrStdout(), client, opts)
		},
	}
	cmdutil.Positionals(cmd, cmdutil.Arg{Name: "DIR", Help: "Directory containing resource YAML/JSON files"})
	flags := cmd.Flags()
	flags.BoolVar(&opts.dryRun, "dry-run", false, "Compute and print the diff without writing")
	flags.BoolVarP(&opts.yes, "yes", "y", false, "Skip the confirmation prompt (required in non-interactive contexts)")
	opts.preview = cmdutil.OptionalValue(cmd, "preview", "Reconcile into a preview instead of live state. With no value the current git branch is used; pass a name where no branch is available (CI, detached HEAD)")
	cmdutil.ValueName(cmd, "preview", "NAME")
	flags.BoolVar(&opts.adopt, "adopt", false, "Adopt resources owned by another Repoid into this repository. Without it, ownership collisions abort the apply")
	cmdutil.SetHumanStdout(cmd, cmdutil.HumanAlways)
	return cmd
}

func run(ctx context.Context, w io.Writer, client *api.Client, opts *options) error {
	dir := opts.dir
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return fmt.Errorf("%s is not a directory", dir)
	}
	// The repoid comes from everr.yaml, else from the origin remote that
	// DetectGitSource already read. Resolve it before parsing resources so
	// unrelated YAML errors cannot hide a missing identity.
	source := DetectGitSource(dir)
	remote := ""
	if source != nil && source.Remote != nil {
		remote = *source.Remote
	}
	repoid, err := ResolveRepoid(dir, remote)
	if err != nil {
		return err
	}
	manifest, err := LoadApplyManifest(dir)
	if err != nil {
		return err
	}
	origin := "inferred from origin remote"
	if manifest != "" {
		origin = "everr.yaml"
	}
	fmt.Fprintf(w, "Repoid: %s (%s)\n", repoid, origin)
	documents, err := LoadResourceDocuments(dir)
	if err != nil {
		return err
	}
	if len(documents) == 0 {
		fmt.Fprintf(os.Stderr, "warning: no resource files (.yaml/.yml/.json) found under %s\n", dir)
	}
	state, err := ClassifyDocuments(documents)
	if err != nil {
		return err
	}
	var preview *string
	if flag, set := opts.preview.Get(); set {
		name, err := ResolvePreviewName(dir, flag)
		if err != nil {
			return err
		}
		preview = &name
	}

	client.PrintTarget()
	request := &api.ApplyRequest{Repoid: repoid, State: state, Source: source, Preview: preview, DryRun: true, Adopt: opts.adopt}
	plan, err := client.Apply(ctx, request)
	if err != nil {
		return err
	}
	printSummary(w, plan, true)
	if opts.dryRun {
		return nil
	}
	if !hasChanges(plan) {
		fmt.Fprintln(w, "Nothing to apply.")
		return nil
	}

	// Previews are disposable and apply without confirmation; a live apply
	// is gated behind a warning-styled confirmation.
	if preview == nil {
		org := lipgloss.NewStyle().Foreground(lipgloss.ANSIColor(208)).Bold(true).Render(plan.Organization.Name)
		proceed, err := Confirm(
			fmt.Sprintf("Are you sure you want to apply this change to %s?", org),
			opts.yes, true,
			fmt.Sprintf("refusing to apply to %s without confirmation; re-run with --yes", plan.Organization.Name),
		)
		if err != nil {
			return err
		}
		if !proceed {
			fmt.Fprintln(w, "Aborted.")
			return nil
		}
	}

	request.DryRun = false
	summary, err := client.Apply(ctx, request)
	if err != nil {
		return err
	}
	printSummary(w, summary, false)
	if preview != nil {
		url := client.BaseURL() + "/dashboards?preview=" + percentEncode(*preview)
		fmt.Fprintf(w, "Preview: %s\n", previewLink(url))
	}
	return nil
}

func hasChanges(summary *api.ApplySummary) bool {
	for _, r := range summary.Results {
		if len(r.Created) > 0 || len(r.Updated) > 0 || len(r.Deleted) > 0 {
			return true
		}
	}
	return false
}

func printSummary(w io.Writer, summary *api.ApplySummary, plan bool) {
	label := ""
	if plan {
		label = "(plan) "
	}
	fmt.Fprintf(w, "%sDestination org: «%s»\n", label, summary.Organization.Name)
	for _, r := range summary.Results {
		adopted := ""
		if len(r.Adopted) > 0 {
			adopted = fmt.Sprintf(", %d adopted", len(r.Adopted))
		}
		fmt.Fprintf(w, "%s%s: %d created, %d updated, %d deleted%s\n",
			label, r.Kind, len(r.Created), len(r.Updated), len(r.Deleted), adopted)
		for _, group := range []struct {
			mark  string
			slugs []string
		}{{"+", r.Created}, {"~", r.Updated}, {"-", r.Deleted}, {"⇄", r.Adopted}} {
			for _, slug := range group.slugs {
				fmt.Fprintf(w, "  %s %s\n", group.mark, slug)
			}
		}
		if r.Note != nil {
			fmt.Fprintf(w, "  note: %s\n", *r.Note)
		}
	}
}

// previewLink renders url as an OSC 8 hyperlink, since many terminals do not
// auto-detect URLs or mangle their `?`/`%2F` query. Pipes, CI, and NO_COLOR
// get the plain URL.
func previewLink(url string) string {
	if _, noColor := os.LookupEnv("NO_COLOR"); !noColor && term.IsTerminal(int(os.Stdout.Fd())) {
		return osc8Hyperlink(url)
	}
	return url
}

// osc8Hyperlink shows the URL itself as the link text, so terminals without
// OSC 8 support still print a readable address.
func osc8Hyperlink(url string) string {
	return "\x1b]8;;" + url + "\x1b\\" + url + "\x1b]8;;\x1b\\"
}

// percentEncode is RFC 3986 query-component encoding.
func percentEncode(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9', c == '-', c == '_', c == '.', c == '~':
			b.WriteByte(c)
		default:
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

// Confirm gates a destructive action: yes skips the prompt, interactive
// terminals ask (warning-styled when warn), and non-interactive contexts fail
// with refusal.
func Confirm(question string, yes, warn bool, refusal string) (bool, error) {
	if yes {
		return true, nil
	}
	if !term.IsTerminal(int(os.Stdin.Fd())) || !term.IsTerminal(int(os.Stdout.Fd())) {
		return false, errors.New(refusal)
	}
	proceed := false
	prompt := huh.NewConfirm().Title(question).Value(&proceed)
	form := huh.NewForm(huh.NewGroup(prompt))
	if warn {
		form = form.WithTheme(warnTheme())
	}
	if err := form.Run(); err != nil {
		return false, err
	}
	return proceed, nil
}

// warnTheme paints the prompt yellow with a ▲ marker, flagging that a live
// apply is about to write.
func warnTheme() *huh.Theme {
	theme := huh.ThemeBase()
	yellow := lipgloss.ANSIColor(3)
	theme.Focused.Base = theme.Focused.Base.BorderForeground(yellow)
	theme.Focused.Title = theme.Focused.Title.Foreground(yellow).SetString("▲")
	return theme
}
