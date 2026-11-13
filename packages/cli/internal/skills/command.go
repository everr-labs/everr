package skills

import (
	"errors"
	"fmt"
	"io"
	"os"
	"slices"
	"strings"

	"github.com/charmbracelet/huh"
	"github.com/spf13/cobra"
	"golang.org/x/term"

	"github.com/everr-labs/everr/packages/cli/internal/cmdutil"
)

var agentValues = []string{"all", "codex", "claude-code", "cursor"}

// NewCommand builds `everr skills`.
func NewCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "skills",
		Short: "Manage bundled Everr skills",
	}
	cmd.AddCommand(newListCommand(), newInstallCommand(), newUpdateCommand(), newUninstallCommand())
	return cmd
}

type scopeFlags struct {
	project, global bool
}

func addScopeFlags(cmd *cobra.Command) *scopeFlags {
	flags := &scopeFlags{}
	cmd.Flags().BoolVar(&flags.project, "project", false, "Use project-local .agents/skills in the current directory")
	cmd.Flags().BoolVar(&flags.global, "global", false, "Use global ~/.agents/skills")
	return flags
}

func (s *scopeFlags) validate(cmd *cobra.Command) error {
	if s.project && s.global {
		return cmdutil.UsageErrorf(cmd, "the argument '--project' cannot be used with '--global'")
	}
	return nil
}

func (s *scopeFlags) set() bool { return s.project || s.global }

func (s *scopeFlags) scope() Scope {
	if s.global {
		return ScopeGlobal
	}
	return ScopeProject
}

func addAgentFlag(cmd *cobra.Command, usage string) func() []Provider {
	agents := cmdutil.EnumSlice(cmd, "agent", usage, agentValues...)
	cmdutil.ValueName(cmd, "agent", "AGENT")
	return func() []Provider { return resolveProviders(agents()) }
}

func leaf(cmd *cobra.Command) *cobra.Command {
	cmd.Flags().SortFlags = false
	cmdutil.SetHumanStdout(cmd, cmdutil.HumanAlways)
	return cmd
}

func newListCommand() *cobra.Command {
	cmd := leaf(&cobra.Command{Use: "list", Short: "List bundled Everr skills"})
	cmdutil.Positionals(cmd)
	scope := addScopeFlags(cmd)
	providers := addAgentFlag(cmd, "Agent to inspect")
	cmd.RunE = func(cmd *cobra.Command, _ []string) error {
		if err := scope.validate(cmd); err != nil {
			return err
		}
		return runList(cmd.OutOrStdout(), scope.scope(), providers())
	}
	return cmd
}

func newInstallCommand() *cobra.Command {
	cmd := leaf(&cobra.Command{Use: "install", Short: "Install bundled Everr skills"})
	cmdutil.Positionals(cmd)
	all := cmd.Flags().Bool("all", false, "Install all bundled skills")
	scope := addScopeFlags(cmd)
	providers := addAgentFlag(cmd, "Agent to install for")
	dryRun := cmd.Flags().Bool("dry-run", false, "Preview without writing files")
	cmd.RunE = func(cmd *cobra.Command, _ []string) error {
		if err := scope.validate(cmd); err != nil {
			return err
		}
		return runInstall(cmd.OutOrStdout(), *all, scope, providers(), cmd.Flags().Changed("agent"), *dryRun)
	}
	return cmd
}

func newUpdateCommand() *cobra.Command {
	cmd := leaf(&cobra.Command{Use: "update", Short: "Update installed bundled Everr skills"})
	cmdutil.Positionals(cmd, cmdutil.Arg{
		Name: "SKILLS", Help: "Skill names to update. With none, updates installed bundled skills",
		Optional: true, Variadic: true,
	})
	scope := addScopeFlags(cmd)
	providers := addAgentFlag(cmd, "Agent to update")
	dryRun := cmd.Flags().Bool("dry-run", false, "Preview without writing files")
	cmd.RunE = func(cmd *cobra.Command, args []string) error {
		if err := scope.validate(cmd); err != nil {
			return err
		}
		return runUpdate(cmd.OutOrStdout(), args, scope, providers(), *dryRun)
	}
	return cmd
}

func newUninstallCommand() *cobra.Command {
	cmd := leaf(&cobra.Command{Use: "uninstall", Short: "Uninstall bundled Everr skills"})
	cmdutil.Positionals(cmd, cmdutil.Arg{
		Name: "SKILLS", Help: "Skill names to uninstall", Optional: true, Variadic: true,
	})
	all := cmd.Flags().Bool("all", false, "Uninstall all bundled skills")
	yes := cmd.Flags().BoolP("yes", "y", false, "Confirm uninstalling all bundled skills")
	scope := addScopeFlags(cmd)
	providers := addAgentFlag(cmd, "Agent to uninstall from")
	dryRun := cmd.Flags().Bool("dry-run", false, "Preview without removing files")
	cmd.RunE = func(cmd *cobra.Command, args []string) error {
		if err := scope.validate(cmd); err != nil {
			return err
		}
		return runUninstall(cmd.OutOrStdout(), args, *all, *yes, scope.scope(), providers(), *dryRun)
	}
	return cmd
}

func runList(w io.Writer, scope Scope, providers []Provider) error {
	skills, err := Bundled()
	if err != nil {
		return err
	}
	scopeLabel := "project"
	if scope == ScopeGlobal {
		scopeLabel = "global"
	}
	providerLabel := "all providers"
	if len(providers) > 0 {
		names := make([]string, len(providers))
		for i, provider := range providers {
			names[i] = provider.DisplayName()
		}
		providerLabel = strings.Join(names, ", ")
	}
	fmt.Fprintf(w, "%d bundled Everr skill(s) for %s scope (%s):\n", len(skills), scopeLabel, providerLabel)
	for _, skill := range skills {
		fmt.Fprintf(w, "- %s - %s\n", skill.Name, skill.Description)
	}
	return nil
}

// agentChosen is whether --agent was passed: `--agent all` selects every
// provider without asking, like no flag does off a terminal.
func runInstall(w io.Writer, all bool, scopeArgs *scopeFlags, providers []Provider, agentChosen, dryRun bool) error {
	interactive := isInteractiveTerminal()
	if !all {
		if !interactive {
			return errors.New("use --all to install bundled Everr skills")
		}
		install := true
		if err := cmdutil.RunPrompt(huh.NewConfirm().Title("Install all bundled Everr skills?").Value(&install)); err != nil {
			return err
		}
		if !install {
			fmt.Fprintln(os.Stderr, "Skipping Everr skills.")
			return nil
		}
	}

	homeDir, err := resolveHomeDir()
	if err != nil {
		return err
	}
	scope := ScopeProject
	switch {
	case scopeArgs.set():
		scope = scopeArgs.scope()
	case interactive:
		if scope, err = promptScope(); err != nil {
			return err
		}
	}
	if !agentChosen && interactive {
		if providers, err = promptProviders(homeDir); err != nil {
			return err
		}
	}
	options, err := operationOptions(scope, homeDir, providers, nil, true, dryRun)
	if err != nil {
		return err
	}
	summary, err := Install(options)
	if err != nil {
		return err
	}
	printSummary(w, "Installed", "Would install", summary)
	return nil
}

func runUpdate(w io.Writer, skills []string, scopeArgs *scopeFlags, providers []Provider, dryRun bool) error {
	homeDir, err := resolveHomeDir()
	if err != nil {
		return err
	}
	if len(skills) > 0 {
		// Updating a legacy skill installs its successor.
		for i, name := range skills {
			if renamed, ok := renamedSkillName(strings.TrimSpace(name)); ok {
				skills[i] = renamed
			}
		}
		if skills, err = resolveSkillNames(Options{SkillNames: skills}); err != nil {
			return err
		}
	}
	var summary Summary
	if scopeArgs.set() {
		options, err := operationOptions(scopeArgs.scope(), homeDir, providers, skills, false, dryRun)
		if err != nil {
			return err
		}
		if len(skills) == 0 {
			if options.SkillNames, err = InstalledUpdateSkillNames(options); err != nil {
				return err
			}
		}
		if summary, err = Update(options); err != nil {
			return err
		}
	} else if summary, err = updateInstalledScopes(homeDir, providers, skills, dryRun); err != nil {
		return err
	}
	printSummary(w, "Updated", "Would update", summary)
	return nil
}

// updateInstalledScopes updates whatever is installed in the project and
// global scopes, so `skills update` works without knowing where skills went.
func updateInstalledScopes(homeDir string, providers []Provider, requested []string, dryRun bool) (Summary, error) {
	merged := Summary{DryRun: dryRun}
	updated := false
	for _, scope := range []Scope{ScopeProject, ScopeGlobal} {
		options, err := operationOptions(scope, homeDir, providers, nil, false, dryRun)
		if err != nil {
			return Summary{}, err
		}
		installed, err := InstalledUpdateSkillNames(options)
		if err != nil {
			return Summary{}, err
		}
		names := installed
		if len(requested) > 0 {
			names = slices.DeleteFunc(slices.Clone(requested), func(name string) bool {
				return !slices.Contains(installed, name)
			})
		}
		if len(names) == 0 {
			continue
		}
		options.SkillNames = names
		summary, err := Update(options)
		if err != nil {
			return Summary{}, err
		}
		updated = true
		merged.Skills = append(merged.Skills, summary.Skills...)
		merged.Changes = append(merged.Changes, summary.Changes...)
	}
	if !updated {
		if len(requested) > 0 {
			return Summary{}, fmt.Errorf("no installed bundled Everr skills found matching %s", strings.Join(requested, ", "))
		}
		return Summary{}, errors.New("no installed bundled Everr skills found in project or global scope")
	}
	slices.Sort(merged.Skills)
	merged.Skills = slices.Compact(merged.Skills)
	return merged, nil
}

func runUninstall(w io.Writer, skills []string, all, yes bool, scope Scope, providers []Provider, dryRun bool) error {
	switch {
	case all && len(skills) > 0:
		return errors.New("skill names cannot be provided when --all is set")
	case !all && len(skills) == 0:
		return errors.New("provide at least one skill name or use --all")
	case all && !yes:
		return errors.New("refusing to uninstall all bundled Everr skills without --yes")
	}
	homeDir, err := resolveHomeDir()
	if err != nil {
		return err
	}
	options, err := operationOptions(scope, homeDir, providers, skills, all, dryRun)
	if err != nil {
		return err
	}
	summary, err := Uninstall(options)
	if err != nil {
		return err
	}
	printSummary(w, "Uninstalled", "Would uninstall", summary)
	return nil
}

// UninstallAllGlobal removes every globally installed bundled skill for all
// providers and prints what it removed. `everr uninstall` uses it.
func UninstallAllGlobal() error {
	homeDir, err := resolveHomeDir()
	if err != nil {
		return err
	}
	options, err := operationOptions(ScopeGlobal, homeDir, AllProviders, nil, true, false)
	if err != nil {
		return err
	}
	summary, err := Uninstall(options)
	if err != nil {
		return err
	}
	printSummary(os.Stdout, "Uninstalled", "Would uninstall", summary)
	return nil
}

func operationOptions(scope Scope, homeDir string, providers []Provider, skills []string, all, dryRun bool) (Options, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return Options{}, fmt.Errorf("could not determine current directory: %w", err)
	}
	return Options{
		Scope: scope, Cwd: cwd, HomeDir: homeDir, Providers: providers,
		SkillNames: skills, All: all, DryRun: dryRun,
	}, nil
}

// resolveProviders maps --agent values to providers. No value, or "all",
// selects every provider, expressed as an empty list.
func resolveProviders(agents []string) []Provider {
	if len(agents) == 0 || slices.Contains(agents, "all") {
		return nil
	}
	providers := make([]Provider, 0, len(agents))
	for _, agent := range agents {
		for _, provider := range AllProviders {
			if provider.String() == agent {
				providers = append(providers, provider)
			}
		}
	}
	return providers
}

func resolveHomeDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to resolve home directory: %w", err)
	}
	return home, nil
}

func isInteractiveTerminal() bool {
	return term.IsTerminal(int(os.Stdin.Fd())) && term.IsTerminal(int(os.Stdout.Fd()))
}

func promptScope() (Scope, error) {
	scope := ScopeProject
	err := cmdutil.RunPrompt(huh.NewSelect[Scope]().
		Title("Install skills at project's level or globally?").
		Options(huh.NewOption("Project", ScopeProject), huh.NewOption("Globally", ScopeGlobal)).
		Value(&scope))
	return scope, err
}

// promptProviders preselects detected providers, or all of them when none is
// detected.
func promptProviders(homeDir string) ([]Provider, error) {
	statuses := ProviderStatuses(homeDir)
	anyDetected := slices.ContainsFunc(statuses, func(s ProviderStatus) bool { return s.Detected })
	options := make([]huh.Option[Provider], len(statuses))
	var selected []Provider
	for i, status := range statuses {
		hint := "not detected"
		if status.Detected {
			hint = "detected"
		}
		label := fmt.Sprintf("%s (%s)", status.Provider.DisplayName(), hint)
		options[i] = huh.NewOption(label, status.Provider)
		if status.Detected || !anyDetected {
			selected = append(selected, status.Provider)
		}
	}
	err := cmdutil.RunPrompt(huh.NewMultiSelect[Provider]().
		Title("Select providers").
		Options(options...).
		Value(&selected).
		Validate(func(providers []Provider) error {
			if len(providers) == 0 {
				return errors.New("Please select at least one option")
			}
			return nil
		}))
	if err != nil {
		return nil, err
	}
	if len(selected) == 0 {
		return nil, errors.New("no providers selected")
	}
	return selected, nil
}

func printSummary(w io.Writer, done, dryRun string, summary Summary) {
	verb := done
	if summary.DryRun {
		verb = dryRun
	}
	suffix := "s"
	if len(summary.Skills) == 1 {
		suffix = ""
	}
	fmt.Fprintf(w, "%s %d skill%s: %s\n", verb, len(summary.Skills), suffix, strings.Join(summary.Skills, ", "))
	for _, change := range summary.Changes {
		if change.Action == Unchanged {
			continue
		}
		if change.Provider != nil {
			fmt.Fprintf(w, "- %s %s for %s: %s\n", change.Skill, change.Action, change.Provider.DisplayName(), change.Path)
		} else {
			fmt.Fprintf(w, "- %s %s: %s\n", change.Skill, change.Action, change.Path)
		}
	}
}
