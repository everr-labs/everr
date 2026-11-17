package recording

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func mirrorOf(t *testing.T, node obj) *mirror {
	t.Helper()
	m := newMirror()
	m.apply(eventOf(t, snapshot(0, node)))
	return m
}

func assertLines(t *testing.T, got []string, want ...string) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("lines:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestOutlineFlattensWrappersKeepsSemanticElementsAndQuotesValues(t *testing.T) {
	page := doc(el("div", obj{"class": "layout-xyz"},
		el("main", obj{},
			el("div", obj{}, el("h1", obj{}, text("Checkout"))),
			el("form", obj{"id": "payment"},
				el("input", obj{"name": "card", "type": "text", "value": "****************"}),
				el("input", obj{"type": "hidden", "name": "csrf", "value": "token"}),
				el("button", obj{"type": "submit", "class": "btn is-loading"}, el("span", obj{}, text("Pay now"))),
			),
			el("svg", obj{}, el("path", obj{"d": "M0"})),
			el("script", obj{}, text("evil()")),
		),
	))
	view := mirrorOf(t, page).view(Outline)
	assertLines(t, view.lines,
		"main",
		`  h1 "Checkout"`,
		"  form#payment",
		// A Masked value stays: its length says the field was filled. A hidden input is not on the page.
		`    input name="card" type="text" value="****************"`,
		// Text that names an element is printed whole, last; class only when it names a state.
		`    button type="submit" class="is-loading" "Pay now"`,
	)
	if view.totalLines != 5 || view.masked {
		t.Fatalf("total %d, masked %v", view.totalLines, view.masked)
	}
}

func TestOutlineLeavesMaskedTextOutSaysSoAndFoldsIdenticalSiblings(t *testing.T) {
	card := func() obj {
		return el("article", obj{}, el("h3", obj{}, text("****")), el("p", obj{}, text("***")))
	}
	page := doc(
		el("h1", obj{}, text("****** ***")),
		el("p", obj{"id": "status"}, text("*** *****")),
		el("ul", obj{"id": "items"},
			el("li", obj{}, text("**** *")),
			el("li", obj{}, text("**** *")),
			el("li", obj{}, text("**** **")),
			el("li", obj{}, text("Total")),
		),
		card(),
		card(),
		el("button", obj{"aria-label": "*****"}, text("****")),
		el("div", obj{"id": "radix-:r1:"}),
	)
	view := mirrorOf(t, page).view(Outline)
	assertLines(t, view.lines,
		"h1",
		"p#status",
		"ul#items",
		"  li \u00D73",
		`  li "Total"`,
		"article \u00D72",
		"  h3",
		"  p",
		"button",
		// An id that is not one word is quoted.
		`div id="radix-:r1:"`,
	)
	if view.totalLines != 10 || !view.masked {
		t.Fatalf("total %d, masked %v", view.totalLines, view.masked)
	}
}

func TestOutlinePrintsDisabledAndCheckedAsFlagsAndLinksWithoutTheirQuery(t *testing.T) {
	page := doc(
		el("a", obj{"href": "/reset?token=secret#x"}, text("Reset")),
		el("input", obj{"type": "checkbox", "checked": ""}),
		el("button", obj{"disabled": ""}, text("Go")),
	)
	assertLines(t, mirrorOf(t, page).view(Outline).lines,
		`a href="/reset" "Reset"`,
		`input type="checkbox" checked`,
		`button disabled "Go"`,
	)
}

func TestOutlineCapsChildrenWithAMarkerLine(t *testing.T) {
	var items []any
	for i := range 20 {
		items = append(items, el("li", obj{}, text(fmt.Sprintf("item %d", i))))
	}
	view := mirrorOf(t, doc(el("ul", obj{}, items...))).view(Outline)
	if len(view.lines) != 1+12+1 || view.lines[len(view.lines)-1] != "  ... 8 more siblings" || view.totalLines != 21 {
		t.Fatalf("lines %q, total %d", view.lines, view.totalLines)
	}
}

func outlineItems(m *mirror) []viewItem {
	masked := false
	return collapseRuns(m.outline(m.root, 0, &masked))
}

func TestOutlinePicksTheDeepestRenderingThatFitsAndMarksWhatIsBelow(t *testing.T) {
	var deep func(n int) obj
	deep = func(n int) obj {
		if n == 0 {
			return el("p", obj{}, text("leaf"))
		}
		return el("section", obj{"id": fmt.Sprintf("s%d", n)}, deep(n-1))
	}
	m := mirrorOf(t, doc(deep(6)))
	if got := len(m.view(Outline).lines); got != 7 {
		t.Fatalf("%d lines", got)
	}
	lines, total := fit(outlineItems(m), budget{lines: 5, chars: 10_000})
	last := lines[len(lines)-1]
	if len(lines) > 5 || !strings.HasPrefix(strings.TrimLeft(last, " "), "... ") || !strings.HasSuffix(last, " more lines") || total != 7 {
		t.Fatalf("lines %q, total %d", lines, total)
	}
}

func TestOutlineNeverExceedsItsBudgetEvenWhenOneLevelDoesNotFit(t *testing.T) {
	var paragraphs []any
	for i := range 40 {
		paragraphs = append(paragraphs, el("p", obj{}, text(strings.Repeat(fmt.Sprintf("paragraph %d ", i), 5))))
	}
	m := mirrorOf(t, doc(paragraphs...))
	for _, b := range []budget{{3, 10_000}, {100, 300}, {10, 400}} {
		out, _ := fit(outlineItems(m), b)
		last := out[len(out)-1]
		if len(out) > b.lines || charsOf(out) > b.chars || !(strings.HasSuffix(last, "more lines") || strings.HasSuffix(last, "more siblings")) {
			t.Errorf("%+v: %q", b, out)
		}
	}
}

func TestViewIsEmptyBeforeASnapshot(t *testing.T) {
	if view := newMirror().view(Outline); !reflect.DeepEqual(view, pageView{}) {
		t.Fatalf("view = %+v", view)
	}
}

func TestHTMLGivesTheBodyAsCompactHTMLOneElementPerLine(t *testing.T) {
	assertLines(t, mirrorOf(t, formSnapshot()).view(HTML).lines,
		"<body>",
		"  <h1>Checkout</h1>",
		`  <input name="email" type="email">`,
		`  <button id="pay">Pay now</button>`,
		"  <div>Plain</div>",
		"</body>",
	)
}

func TestHTMLKeepsAttributeValuesAndTextOnWholeLines(t *testing.T) {
	page := doc(el("p", obj{"title": "a\nb"}, text("x\ny"), el("b", obj{}, text("z"))))
	lines := mirrorOf(t, page).view(HTML).lines
	joined := strings.Join(lines, "|")
	if strings.Contains(joined, "\n") || !strings.Contains(joined, `title="a&#10;b"`) {
		t.Fatalf("lines %q", lines)
	}
}

func TestAppliesRemovesAddsTextsAttributesAndInputsByID(t *testing.T) {
	m := mirrorOf(t, formSnapshot())
	m.apply(eventOf(t, mutation(1, obj{
		"texts":      []any{obj{"id": 12, "value": "Order placed"}},
		"attributes": []any{obj{"id": 14, "attributes": obj{"disabled": "", "style": obj{"color": "red"}}}},
		"removes":    []any{obj{"parentId": 10, "id": 13}},
		// The first add names a sibling the second one creates.
		"adds": []any{
			obj{"parentId": 10, "nextId": 50, "node": el("p", obj{"id": "before"})},
			obj{"parentId": 10, "nextId": nil, "node": obj{"type": 2, "tagName": "p", "attributes": obj{"id": "after"}, "childNodes": []any{}, "id": 50}},
		},
	})))
	m.apply(eventOf(t, input(2, 14, "typed")))
	if m.lost {
		t.Fatal("lost")
	}
	assertLines(t, m.view(Outline).lines,
		`h1 "Order placed"`,
		`button#pay disabled "Pay now"`,
		`div "Plain"`,
		"p#before",
		"p#after",
	)
	if got := m.stringAttr(m.ids[14], "value"); got != "typed" {
		t.Fatalf("value = %q", got)
	}
}

func TestMarksAChangeToANodeItDoesNotHave(t *testing.T) {
	m := mirrorOf(t, formSnapshot())
	m.apply(eventOf(t, mutation(1, obj{"texts": []any{obj{"id": 999, "value": "lost"}}})))
	if !m.lost {
		t.Fatal("not lost")
	}
}

func TestBuildsAndReadsAPage200000ElementsDeep(t *testing.T) {
	// One add per level, each under the last: no JSON is deep, the page is.
	const depth, first = 200_000, 1_000_000
	m := mirrorOf(t, doc(elID("div", obj{"id": "top"}, nil, 5)))
	adds := make([]any, depth)
	for i := range depth {
		parent := first + i - 1
		if i == 0 {
			parent = 5
		}
		adds[i] = obj{
			"parentId": parent,
			"nextId":   nil,
			"node":     obj{"type": 2, "tagName": "section", "attributes": obj{"id": fmt.Sprintf("s%d", i)}, "childNodes": []any{}, "id": first + i},
		}
	}
	m.apply(eventOf(t, mutation(1, obj{"adds": adds})))
	if m.lost {
		t.Fatal("lost")
	}
	view := m.view(Outline)
	if len(view.lines) > 100 || view.lines[0] != "div#top" {
		t.Fatalf("outline %q", view.lines)
	}
	if got := len(m.view(HTML).lines); got > 160 {
		t.Fatalf("%d HTML lines", got)
	}
	// Removing the top takes everything below it out too.
	m.apply(eventOf(t, mutation(2, obj{"removes": []any{obj{"parentId": 5, "id": first}}})))
	if m.lost {
		t.Fatal("lost")
	}
	assertLines(t, m.view(Outline).lines, "div#top")
}

func TestAFullSnapshotStartsOver(t *testing.T) {
	m := mirrorOf(t, formSnapshot())
	m.apply(eventOf(t, mutation(1, obj{"texts": []any{obj{"id": 999, "value": "lost"}}})))
	m.apply(eventOf(t, snapshot(2, doc(el("h2", obj{}, text("Fresh"))))))
	if m.lost {
		t.Fatal("lost")
	}
	assertLines(t, m.view(Outline).lines, `h2 "Fresh"`)
}
