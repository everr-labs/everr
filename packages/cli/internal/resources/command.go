// Package resources implements `everr resources`, which inspects and manages
// live as-code resources.
package resources

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"

	"github.com/spf13/cobra"
	"go.yaml.in/yaml/v3"

	"github.com/everr-labs/everr/packages/cli/internal/api"
	"github.com/everr-labs/everr/packages/cli/internal/apply"
	"github.com/everr-labs/everr/packages/cli/internal/auth"
	"github.com/everr-labs/everr/packages/cli/internal/cmdutil"
)

var kinds = []string{"dashboard", "runbook", "alert"}

// NewCommand builds `everr resources`.
func NewCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "resources",
		Short: "Inspect and manage live dashboards, runbooks, and alerts",
	}
	cmd.AddCommand(listCommand(), showCommand(), deleteCommand(), adoptCommand())
	return cmd
}

// target is a resource named by `<KIND> <SLUG> --project`.
type target struct {
	kind, slug, project string
}

func (t target) String() string { return t.kind + "/" + t.project + "/" + t.slug }

func bindTarget(cmd *cobra.Command) *target {
	t := &target{}
	cmdutil.Positionals(cmd,
		cmdutil.Arg{Name: "KIND", Help: "Resource kind [possible values: dashboard, runbook, alert]"},
		cmdutil.Arg{Name: "SLUG", Help: "Resource slug (metadata.name)"},
	)
	countArgs := cmd.Args
	cmd.Args = func(cmd *cobra.Command, args []string) error {
		if err := countArgs(cmd, args); err != nil {
			return err
		}
		if err := cmdutil.EnumArg(cmd, "KIND", args[0], kinds...); err != nil {
			return err
		}
		t.kind, t.slug = args[0], args[1]
		return nil
	}
	cmd.Flags().StringVar(&t.project, "project", "default", "Project name")
	cmdutil.ShowDefault(cmd, "project")
	return t
}

func newClient() (*api.Client, error) { return auth.NewClient(false) }

func listCommand() *cobra.Command {
	var asJSON bool
	var repoid cmdutil.OptionalString
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List live resources across the organization",
	}
	kind := cmdutil.Enum(cmd, "kind", "Only resources of this kind", kinds...)
	cmd.Flags().Var(&repoid, "repoid", "Only resources owned by this Repoid (pass an empty string for UI-created)")
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output raw JSON instead of a table")
	cmdutil.Positionals(cmd)
	cmd.RunE = func(cmd *cobra.Command, _ []string) error {
		client, err := newClient()
		if err != nil {
			return err
		}
		var filter *string
		if value, ok := repoid.Get(); ok {
			filter = &value
		}
		resources, err := client.ListResources(cmd.Context(), kind(), filter)
		if err != nil {
			return err
		}
		return printList(cmd.OutOrStdout(), resources, asJSON)
	}
	cmdutil.SetHumanStdout(cmd, func(*cobra.Command, bool) bool { return !asJSON })
	return cmd
}

func printList(w io.Writer, resources []api.ResourceSummary, asJSON bool) error {
	if asJSON {
		if resources == nil {
			resources = []api.ResourceSummary{}
		}
		return printJSON(w, resources)
	}
	if len(resources) == 0 {
		fmt.Fprintln(w, "No resources.")
		return nil
	}
	// Best effort: only used to star this repository's rows.
	mine, err := apply.ResolveRepoidForDir(".")
	known := err == nil
	fmt.Fprintf(w, "%-10s  %-10s  %-28s  %-24s  UPDATED\n", "KIND", "PROJECT", "SLUG", "REPOID")
	for _, r := range resources {
		repoid := r.Repoid
		if repoid == "" {
			repoid = "(ui)"
		}
		star := " "
		if known && r.Repoid != "" && r.Repoid == mine {
			star = "*"
		}
		fmt.Fprintf(w, "%s%-9s  %-10s  %-28s  %-24s  %s\n", star, r.Kind, r.Project, r.Slug, repoid, r.UpdatedAt)
	}
	if known {
		fmt.Fprintln(w, "\n* owned by this repository")
	}
	return nil
}

func showCommand() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "show",
		Short: "Print a resource's stored configuration",
	}
	t := bindTarget(cmd)
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output raw JSON instead of YAML")
	cmd.RunE = func(cmd *cobra.Command, _ []string) error {
		client, err := newClient()
		if err != nil {
			return err
		}
		raw, err := client.GetResource(cmd.Context(), t.kind, t.project, t.slug)
		if err != nil {
			return err
		}
		document, err := decodeJSON(raw)
		if err != nil {
			return err
		}
		if asJSON {
			return printJSON(cmd.OutOrStdout(), document)
		}
		return printYAML(cmd.OutOrStdout(), document)
	}
	cmdutil.SetHumanStdout(cmd, func(*cobra.Command, bool) bool { return !asJSON })
	return cmd
}

func deleteCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "delete",
		Short: "Delete a live resource without prompting",
	}
	t := bindTarget(cmd)
	cmd.RunE = func(cmd *cobra.Command, _ []string) error {
		client, err := newClient()
		if err != nil {
			return err
		}
		client.PrintTarget()
		if err := client.DeleteResource(cmd.Context(), t.kind, t.project, t.slug); err != nil {
			return err
		}
		w := cmd.OutOrStdout()
		fmt.Fprintf(w, "Deleted %s.\n", t)
		fmt.Fprintln(w, "note: if this resource is still defined in your as-code tree, the next `everr apply` will recreate it.")
		return nil
	}
	cmdutil.SetHumanStdout(cmd, cmdutil.HumanAlways)
	return cmd
}

func adoptCommand() *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:   "adopt",
		Short: "Adopt a resource into this repository's ownership boundary",
	}
	t := bindTarget(cmd)
	cmd.Flags().BoolVarP(&yes, "yes", "y", false, "Skip the confirmation prompt (required in non-interactive contexts)")
	cmd.RunE = func(cmd *cobra.Command, _ []string) error {
		client, err := newClient()
		if err != nil {
			return err
		}
		client.PrintTarget()
		repoid, err := apply.ResolveRepoidForDir(".")
		if err != nil {
			return err
		}
		w := cmd.OutOrStdout()
		proceed, err := apply.Confirm(fmt.Sprintf("Adopt %s into «%s»?", t, repoid), yes, false,
			"refusing to proceed without confirmation; re-run with --yes")
		if err != nil {
			return err
		}
		if !proceed {
			fmt.Fprintln(w, "Aborted.")
			return nil
		}
		outcome, err := client.AdoptResource(cmd.Context(), t.kind, t.project, t.slug, repoid)
		if err != nil {
			return err
		}
		if outcome.AlreadyOwned {
			fmt.Fprintf(w, "%s is already owned by «%s». Nothing to do.\n", t, repoid)
			return nil
		}
		fmt.Fprintf(w, "Adopted %s into «%s».\n", t, repoid)
		fmt.Fprintf(w, "note: if this resource is not in your local tree, the next `everr apply` will delete it.\n"+
			"      save it first: everr resources show %s %s --project %s > everr/%s.%s.yaml\n",
			t.kind, t.slug, t.project, t.slug, t.kind)
		return nil
	}
	cmdutil.SetHumanStdout(cmd, cmdutil.HumanAlways)
	return cmd
}

// decodeJSON keeps number literals intact; maps re-encode with sorted keys,
// as the previous CLI printed them.
func decodeJSON(raw []byte) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, fmt.Errorf("failed to decode CLI API response as JSON: %w", err)
	}
	return value, nil
}

func printJSON(w io.Writer, value any) error {
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func printYAML(w io.Writer, value any) error {
	encoder := yaml.NewEncoder(w)
	encoder.SetIndent(2)
	encoder.CompactSeqIndent()
	if err := encoder.Encode(jsonToYAML(value)); err != nil {
		return err
	}
	return encoder.Close()
}

// jsonToYAML builds the node tree by hand so keys keep plain lexical order
// and numbers keep their literal form.
func jsonToYAML(value any) *yaml.Node {
	switch v := value.(type) {
	case nil:
		return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!null", Value: "null"}
	case bool:
		return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!bool", Value: fmt.Sprint(v)}
	case json.Number:
		// An integer literal stays !!int at any size, so the output can be
		// applied again; yaml.v3 refuses to read a !!float without a fraction.
		tag := "!!int"
		if strings.ContainsAny(v.String(), ".eE") {
			tag = "!!float"
		}
		return &yaml.Node{Kind: yaml.ScalarNode, Tag: tag, Value: v.String()}
	case string:
		return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: v}
	case []any:
		node := &yaml.Node{Kind: yaml.SequenceNode, Tag: "!!seq"}
		for _, item := range v {
			node.Content = append(node.Content, jsonToYAML(item))
		}
		if len(v) == 0 {
			node.Style = yaml.FlowStyle
		}
		return node
	case map[string]any:
		node := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			node.Content = append(node.Content, jsonToYAML(key), jsonToYAML(v[key]))
		}
		if len(v) == 0 {
			node.Style = yaml.FlowStyle
		}
		return node
	}
	return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: fmt.Sprint(value)}
}
