package cmdutil

import (
	"image/color"
	"os"
	"sync"

	"charm.land/huh/v2"
	"charm.land/lipgloss/v2"
)

// Colors from the Everr design tokens (packages/ui/src/styles/global.css),
// with darker variants so prompts stay readable on light terminals.
type palette struct {
	accent, warn, onAccent, text, muted, surface, danger color.Color
}

func paletteFor(isDark bool) palette {
	pick := lipgloss.LightDark(isDark)
	return palette{
		accent:   pick(lipgloss.Color("#677d00"), lipgloss.Color("#d7ff00")), // --primary
		warn:     pick(lipgloss.Color("#af7200"), lipgloss.Color("#f0b100")), // --chart-2
		onAccent: lipgloss.Color("#030400"),                                  // --primary-foreground
		text:     pick(lipgloss.Color("#262626"), lipgloss.Color("#fafafa")), // --foreground
		muted:    pick(lipgloss.Color("#636363"), lipgloss.Color("#a1a1a1")), // --muted-foreground
		surface:  pick(lipgloss.Color("#e5e5e5"), lipgloss.Color("#262626")), // --accent
		danger:   pick(lipgloss.Color("#c4161c"), lipgloss.Color("#ff6467")), // --destructive
	}
}

// huh v2 only learns the background from a message the host program has to
// request, and a form never does, so it would always pick the light palette.
// Prompts only run on a terminal, which makes this the one place to ask.
var terminalIsDark = sync.OnceValue(func() bool {
	return lipgloss.HasDarkBackground(os.Stdin, os.Stdout)
})

// PromptTheme styles interactive prompts in the brand colors.
func PromptTheme() huh.Theme {
	return huh.ThemeFunc(func(bool) *huh.Styles {
		return promptTheme(terminalIsDark(), false, "◆")
	})
}

// WarnPromptTheme styles a prompt that gates a change to live data: amber,
// with a ▲ marker.
func WarnPromptTheme() huh.Theme {
	return huh.ThemeFunc(func(bool) *huh.Styles {
		return promptTheme(terminalIsDark(), true, "▲")
	})
}

// RunPrompt shows a single prompt in the brand theme.
func RunPrompt(field huh.Field) error {
	return huh.NewForm(huh.NewGroup(field)).WithTheme(PromptTheme()).Run()
}

func promptTheme(isDark, warn bool, marker string) *huh.Styles {
	c := paletteFor(isDark)
	accent := c.accent
	if warn {
		accent = c.warn
	}
	t := huh.ThemeBase(isDark)
	f := &t.Focused
	f.Base = f.Base.BorderForeground(accent)
	f.Card = f.Base
	f.Title = f.Title.Foreground(accent).Bold(true).SetString(marker)
	f.Description = f.Description.Foreground(c.muted)
	f.ErrorIndicator = f.ErrorIndicator.Foreground(c.danger)
	f.ErrorMessage = f.ErrorMessage.Foreground(c.danger)
	f.SelectSelector = lipgloss.NewStyle().Foreground(accent).SetString("› ")
	f.MultiSelectSelector = lipgloss.NewStyle().Foreground(accent).SetString("› ")
	f.Option = f.Option.Foreground(c.text)
	f.UnselectedOption = f.UnselectedOption.Foreground(c.text)
	f.SelectedOption = f.SelectedOption.Foreground(accent)
	f.SelectedPrefix = lipgloss.NewStyle().Foreground(accent).SetString("◼ ")
	f.UnselectedPrefix = lipgloss.NewStyle().Foreground(c.muted).SetString("◻ ")
	f.FocusedButton = f.FocusedButton.Foreground(c.onAccent).Background(accent).Bold(true)
	f.Next = f.FocusedButton
	f.BlurredButton = f.BlurredButton.Foreground(c.muted).Background(c.surface)
	f.NextIndicator = f.NextIndicator.Foreground(accent)
	f.PrevIndicator = f.PrevIndicator.Foreground(accent)
	f.TextInput.Cursor = f.TextInput.Cursor.Foreground(accent)
	f.TextInput.Prompt = f.TextInput.Prompt.Foreground(accent)
	f.TextInput.Placeholder = f.TextInput.Placeholder.Foreground(c.muted)

	t.Help.ShortKey = t.Help.ShortKey.Foreground(c.muted)
	t.Help.ShortDesc = t.Help.ShortDesc.Foreground(c.muted)
	t.Help.ShortSeparator = t.Help.ShortSeparator.Foreground(c.muted)

	t.Blurred = t.Focused
	t.Blurred.Base = t.Blurred.Base.BorderStyle(lipgloss.HiddenBorder())
	t.Blurred.Card = t.Blurred.Base
	t.Blurred.MultiSelectSelector = lipgloss.NewStyle().SetString("  ")
	return t
}
