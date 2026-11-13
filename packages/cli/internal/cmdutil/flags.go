package cmdutil

import (
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// Flag annotations read by the help renderer.
const (
	annotationValueName     = "everr_value_name"
	annotationShowDefault   = "everr_show_default"
	annotationPossible      = "everr_possible_values"
	annotationOptionalValue = "everr_optional_value"
)

// Arg is a positional argument, documented in help the way the previous
// clap-based CLI showed it (`<SQL>`, `[SKILLS]...`).
type Arg struct {
	Name     string
	Help     string
	Optional bool
	Variadic bool
}

func (a Arg) usage() string {
	name := "<" + a.Name + ">"
	if a.Optional {
		name = "[" + a.Name + "]"
	}
	if a.Variadic {
		name += "..."
	}
	return name
}

var positionals = map[*cobra.Command][]Arg{}

// Positionals declares cmd's positional arguments for help and sets argument
// count validation. The last argument may be variadic.
func Positionals(cmd *cobra.Command, args ...Arg) {
	positionals[cmd] = args
	minArgs, maxArgs := 0, 0
	for _, arg := range args {
		if !arg.Optional {
			minArgs++
		}
		if arg.Variadic {
			maxArgs = -1
		} else if maxArgs >= 0 {
			maxArgs++
		}
	}
	cmd.Args = func(cmd *cobra.Command, got []string) error {
		missing := []string{}
		for i, arg := range args {
			if !arg.Optional && i >= len(got) {
				missing = append(missing, arg.usage())
			}
		}
		if len(got) < minArgs {
			return usageErrorf(cmd, "the following required arguments were not provided:\n  %s", strings.Join(missing, "\n  "))
		}
		if maxArgs >= 0 && len(got) > maxArgs {
			return usageErrorf(cmd, "unexpected argument '%s' found", got[maxArgs])
		}
		return nil
	}
}

// ValueName sets the placeholder shown for a flag's value (`--preview [<NAME>]`).
// By default it is the upper-snake form of the flag name.
func ValueName(cmd *cobra.Command, flag, name string) {
	mustAnnotate(cmd, flag, annotationValueName, name)
}

// ShowDefault shows the flag's default value in help (`[default: 20]`).
func ShowDefault(cmd *cobra.Command, flag string) {
	mustAnnotate(cmd, flag, annotationShowDefault, "true")
}

func mustAnnotate(cmd *cobra.Command, flag, key, value string) {
	if err := cmd.Flags().SetAnnotation(flag, key, []string{value}); err != nil {
		panic(err)
	}
}

type enumValue struct {
	allowed []string
	values  []string
	repeat  bool
}

func (e *enumValue) String() string {
	if len(e.values) == 0 {
		return ""
	}
	return strings.Join(e.values, ",")
}

func (e *enumValue) Set(raw string) error {
	if !slices.Contains(e.allowed, raw) {
		return possibleValuesError(e.allowed)
	}
	if e.repeat {
		e.values = append(e.values, raw)
	} else {
		e.values = []string{raw}
	}
	return nil
}

func (e *enumValue) Type() string { return "string" }

// Enum adds a flag that accepts one of allowed. The returned function gives the
// chosen value, or "" when the flag was not passed.
func Enum(cmd *cobra.Command, name, usage string, allowed ...string) func() string {
	value := &enumValue{allowed: allowed}
	cmd.Flags().Var(value, name, usage)
	mustAnnotate(cmd, name, annotationPossible, strings.Join(allowed, ", "))
	return func() string { return value.String() }
}

// EnumSlice adds a repeatable flag whose values must each be one of allowed.
func EnumSlice(cmd *cobra.Command, name, usage string, allowed ...string) func() []string {
	value := &enumValue{allowed: allowed, repeat: true}
	cmd.Flags().Var(value, name, usage)
	mustAnnotate(cmd, name, annotationPossible, strings.Join(allowed, ", "))
	return func() []string { return slices.Clone(value.values) }
}

// EnumArg validates a positional argument against allowed values.
func EnumArg(cmd *cobra.Command, name, raw string, allowed ...string) error {
	if slices.Contains(allowed, raw) {
		return nil
	}
	return usageErrorf(cmd, "invalid value '%s' for '<%s>'\n  [possible values: %s]", raw, name, strings.Join(allowed, ", "))
}

// OptionalUint is a flag whose absence is distinguishable from zero.
// Min and Max bound accepted values when either is non-zero.
type OptionalUint struct {
	Min, Max uint32
	value    uint32
	set      bool
}

func (o *OptionalUint) String() string {
	if !o.set {
		return ""
	}
	return strconv.FormatUint(uint64(o.value), 10)
}

func (o *OptionalUint) Set(raw string) error {
	n, err := strconv.ParseUint(raw, 10, 32)
	if err != nil {
		return fmt.Errorf("invalid digit found in string")
	}
	if (o.Min != 0 || o.Max != 0) && (uint32(n) < o.Min || uint32(n) > o.Max) {
		return fmt.Errorf("%d is not in %d..=%d", n, o.Min, o.Max)
	}
	o.value, o.set = uint32(n), true
	return nil
}

func (o *OptionalUint) Type() string { return "uint" }

// Get returns the value and whether the flag was passed.
func (o *OptionalUint) Get() (uint32, bool) { return o.value, o.set }

// OptionalString is a string flag whose absence is distinguishable from "".
type OptionalString struct {
	value string
	set   bool
}

func (o *OptionalString) String() string { return o.value }

func (o *OptionalString) Set(raw string) error {
	if raw == optionalSentinel {
		raw = ""
	}
	o.value, o.set = raw, true
	return nil
}

func (o *OptionalString) Type() string { return "string" }

// Get returns the value and whether the flag was passed.
func (o *OptionalString) Get() (string, bool) { return o.value, o.set }

func valueName(flag *pflag.Flag) string {
	if names := flag.Annotations[annotationValueName]; len(names) > 0 {
		return names[0]
	}
	return strings.ToUpper(strings.ReplaceAll(flag.Name, "-", "_"))
}

func takesValue(flag *pflag.Flag) bool {
	return flag.Value.Type() != "bool"
}

// pflag needs a non-empty NoOptDefVal to allow a bare flag.
const optionalSentinel = "\x00"

// OptionalValue adds a flag whose value may be omitted (`--preview` or
// `--preview NAME`). A bare flag reads as set with an empty value. Like clap,
// a following argument that does not start with "-" is taken as the value.
func OptionalValue(cmd *cobra.Command, name, usage string) *OptionalString {
	value := &OptionalString{}
	cmd.Flags().Var(value, name, usage)
	cmd.Flags().Lookup(name).NoOptDefVal = optionalSentinel
	mustAnnotate(cmd, name, annotationOptionalValue, "true")
	return value
}

// JoinOptionalValues rewrites `--flag value` into `--flag=value` for cmd's
// optional-value flags, which pflag would otherwise leave as a positional.
func JoinOptionalValues(cmd *cobra.Command, args []string) []string {
	out := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			return append(out, args[i:]...)
		}
		if name, ok := strings.CutPrefix(arg, "--"); ok && i+1 < len(args) && !strings.HasPrefix(args[i+1], "-") {
			if flag := cmd.Flags().Lookup(name); flag != nil && flag.Annotations[annotationOptionalValue] != nil {
				out = append(out, arg+"="+args[i+1])
				i++
				continue
			}
		}
		out = append(out, arg)
	}
	return out
}

type possibleValuesError []string

func (e possibleValuesError) Error() string {
	return "[possible values: " + strings.Join(e, ", ") + "]"
}

// InvalidFlagValue rewords pflag's invalid-value error the way clap reported
// it, naming the flag with its value name and listing the accepted values.
func InvalidFlagValue(cmd *cobra.Command, err error) (error, bool) {
	invalid, ok := errors.AsType[*pflag.InvalidValueError](err)
	if !ok {
		return nil, false
	}
	flag := invalid.GetFlag()
	msg := fmt.Sprintf("invalid value '%s' for '--%s <%s>'", invalid.GetValue(), flag.Name, valueName(flag))
	if allowed, ok := errors.AsType[possibleValuesError](err); ok {
		msg += "\n  " + allowed.Error()
	} else if cause := invalid.Unwrap(); cause != nil {
		msg += ": " + cause.Error()
	}
	return &UsageError{Cmd: cmd, Msg: msg, HideUsage: true}, true
}
