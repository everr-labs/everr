package cmdutil

import (
	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
)

// Colors from the Everr design tokens (packages/ui/src/styles/global.css),
// with darker variants so prompts stay readable on light terminals.
var (
	brandAccent = lipgloss.AdaptiveColor{Light: "#677d00", Dark: "#d7ff00"} // --primary
	warnAccent  = lipgloss.AdaptiveColor{Light: "#af7200", Dark: "#f0b100"} // --chart-2
	onAccent    = lipgloss.Color("#030400")                                 // --primary-foreground
	textColor   = lipgloss.AdaptiveColor{Light: "#262626", Dark: "#fafafa"} // --foreground
	mutedColor  = lipgloss.AdaptiveColor{Light: "#636363", Dark: "#a1a1a1"} // --muted-foreground
	surface     = lipgloss.AdaptiveColor{Light: "#e5e5e5", Dark: "#262626"} // --accent
	errorColor  = lipgloss.AdaptiveColor{Light: "#c4161c", Dark: "#ff6467"} // --destructive
)

// PromptTheme styles interactive prompts in the brand colors.
func PromptTheme() *huh.Theme {
	return promptTheme(brandAccent, "◆")
}

// WarnPromptTheme styles a prompt that gates a change to live data: amber,
// with a ▲ marker.
func WarnPromptTheme() *huh.Theme {
	return promptTheme(warnAccent, "▲")
}

// RunPrompt shows a single prompt in the brand theme.
func RunPrompt(field huh.Field) error {
	return huh.NewForm(huh.NewGroup(field)).WithTheme(PromptTheme()).Run()
}

func promptTheme(accent lipgloss.TerminalColor, marker string) *huh.Theme {
	t := huh.ThemeBase()
	f := &t.Focused
	f.Base = f.Base.BorderForeground(accent)
	f.Card = f.Base
	f.Title = f.Title.Foreground(accent).Bold(true).SetString(marker)
	f.Description = f.Description.Foreground(mutedColor)
	f.ErrorIndicator = f.ErrorIndicator.Foreground(errorColor)
	f.ErrorMessage = f.ErrorMessage.Foreground(errorColor)
	f.SelectSelector = lipgloss.NewStyle().Foreground(accent).SetString("› ")
	f.MultiSelectSelector = lipgloss.NewStyle().Foreground(accent).SetString("› ")
	f.Option = f.Option.Foreground(textColor)
	f.UnselectedOption = f.UnselectedOption.Foreground(textColor)
	f.SelectedOption = f.SelectedOption.Foreground(accent)
	f.SelectedPrefix = lipgloss.NewStyle().Foreground(accent).SetString("◼ ")
	f.UnselectedPrefix = lipgloss.NewStyle().Foreground(mutedColor).SetString("◻ ")
	f.FocusedButton = f.FocusedButton.Foreground(onAccent).Background(accent).Bold(true)
	f.Next = f.FocusedButton
	f.BlurredButton = f.BlurredButton.Foreground(mutedColor).Background(surface)
	f.NextIndicator = f.NextIndicator.Foreground(accent)
	f.PrevIndicator = f.PrevIndicator.Foreground(accent)
	f.TextInput.Cursor = f.TextInput.Cursor.Foreground(accent)
	f.TextInput.Prompt = f.TextInput.Prompt.Foreground(accent)
	f.TextInput.Placeholder = f.TextInput.Placeholder.Foreground(mutedColor)

	t.Help.ShortKey = t.Help.ShortKey.Foreground(mutedColor)
	t.Help.ShortDesc = t.Help.ShortDesc.Foreground(mutedColor)
	t.Help.ShortSeparator = t.Help.ShortSeparator.Foreground(mutedColor)

	t.Blurred = t.Focused
	t.Blurred.Base = t.Blurred.Base.BorderStyle(lipgloss.HiddenBorder())
	t.Blurred.Card = t.Blurred.Base
	t.Blurred.MultiSelectSelector = lipgloss.NewStyle().SetString("  ")
	return t
}
