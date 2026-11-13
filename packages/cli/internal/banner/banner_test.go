package banner

import (
	"strings"
	"testing"
)

func TestRendersSameBannerWithOrWithoutColor(t *testing.T) {
	plain := render(false)
	if !strings.Contains(plain, "░████████") || strings.Contains(plain, "\x1b") {
		t.Fatalf("plain banner:\n%s", plain)
	}
	if got := ansiEscape.ReplaceAllString(render(true), ""); got != plain {
		t.Fatalf("colored banner differs once stripped:\n%s", got)
	}
}
