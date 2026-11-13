package commandtelemetry

import (
	"slices"
	"testing"

	"github.com/spf13/cobra"
	"go.opentelemetry.io/otel/attribute"
)

func commandTree() (root, ciLogs, wrap *cobra.Command) {
	root = &cobra.Command{Use: "everr"}
	ci := &cobra.Command{Use: "ci"}
	ciLogs = &cobra.Command{Use: "logs"}
	wrap = &cobra.Command{Use: "wrap"}
	ci.AddCommand(ciLogs)
	root.AddCommand(ci, wrap)
	return root, ciLogs, wrap
}

func TestInternalResourceDoesNotInheritCustomerResourceAttributes(t *testing.T) {
	t.Setenv("OTEL_RESOURCE_ATTRIBUTES", "service.name=customer-app,everr.customer.data=customer-sentinel")
	t.Setenv("OTEL_SERVICE_NAME", "customer-app")
	set := newResource().Set()
	if got, _ := set.Value("service.name"); got.AsString() != "everr-cli" {
		t.Fatalf("service.name = %q", got.AsString())
	}
	if set.HasValue(attribute.Key("everr.customer.data")) {
		t.Fatal("customer resource attribute leaked into internal telemetry")
	}
	if got, _ := set.Value("telemetry.sdk.language"); got.AsString() != "go" {
		t.Fatalf("telemetry.sdk.language = %q", got.AsString())
	}
}

func TestRecordsCommandSubcommandAndOptionNamesWithoutValues(t *testing.T) {
	_, logs, _ := commandTree()
	inv := newInvocation(logs, []string{
		"everr", "ci", "logs", "trace-secret", "--job-name", "deploy-secret",
		"--log-failed", "--tail=50", "--egrep", "token=.*",
	})
	if inv.command != "ci" || inv.subcommand != "logs" {
		t.Fatalf("names = %q %q", inv.command, inv.subcommand)
	}
	if want := []string{"egrep", "job-name", "log-failed", "tail"}; !slices.Equal(inv.options, want) {
		t.Fatalf("options = %v, want %v", inv.options, want)
	}
}

func TestIgnoresWrappedCommandOptions(t *testing.T) {
	_, _, wrap := commandTree()
	for _, argv := range [][]string{
		{"everr", "wrap", "--", "sh", "-c", "echo secret"},
		{"everr", "wrap", "sh", "-c", "echo secret"},
	} {
		inv := newInvocation(wrap, argv)
		if inv.command != "wrap" || inv.subcommand != "" || len(inv.options) != 0 {
			t.Fatalf("%v: %+v", argv, inv)
		}
	}
}

func TestOptionNames(t *testing.T) {
	for _, tc := range []struct {
		argv []string
		want []string
	}{
		{[]string{"everr", "skills", "uninstall", "-y"}, []string{"y"}},
		{[]string{"everr", "skills", "list", "--global", "\xff"}, []string{"global"}},
		{[]string{"everr", "local", "query", "--format", "json", "--", "--not-an-option"}, []string{"format"}},
	} {
		if got := optionNames(tc.argv); !slices.Equal(got, tc.want) {
			t.Errorf("optionNames(%q) = %v, want %v", tc.argv, got, tc.want)
		}
	}
}
