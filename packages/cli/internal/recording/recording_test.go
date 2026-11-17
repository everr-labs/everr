package recording

import (
	"strings"
	"testing"
)

// A checkout: the user fills the form, pays, and the button is disabled while it waits.
const checkoutStart = "2026-11-14T10:20:41.120Z"

func cartPage() obj {
	return obj{"type": 0, "id": 1, "childNodes": []any{el("html", obj{}, el("body", obj{},
		el("main", obj{},
			el("h1", obj{}, text("Cart")),
			elID("a", obj{"href": "/checkout", "data-testid": "checkout"}, []any{text("Checkout")}, 30),
		),
	))}}
}

func checkoutPage(heading string) obj {
	return obj{"type": 0, "id": 1, "childNodes": []any{el("html", obj{}, el("body", obj{},
		el("div", obj{"class": "wrapper"}, el("main", obj{},
			el("h1", obj{}, text(heading)),
			el("form", obj{"id": "payment"},
				el("label", obj{},
					text("Email"),
					elID("input", obj{"name": "email", "type": "email"}, nil, 104),
				),
				elID("input", obj{"name": "card", "type": "text"}, nil, 105),
				elID("button", obj{"type": "submit"}, []any{
					elID("span", obj{}, []any{textID("Pay now", 108)}, 107),
				}, 106),
			),
			elID("div", obj{"role": "status", "class": "toast hidden"}, nil, 110),
		)),
	))}}
}

func checkout(t *testing.T, heading string) string {
	start := ms(t, checkoutStart)
	return body(t,
		meta(start, "https://shop.example.com/cart"),
		snapshot(start+10, cartPage()),
		meta(ms(t, "2026-11-14T10:21:21.120Z"), "https://shop.example.com/checkout?session=abc"),
		snapshot(ms(t, "2026-11-14T10:21:21.130Z"), checkoutPage(heading)),
		input(ms(t, "2026-11-14T10:21:24.120Z"), 104, "********@*******"),
		input(ms(t, "2026-11-14T10:21:26.120Z"), 105, "****************"),
		mutation(ms(t, "2026-11-14T10:21:39.820Z"), obj{"attributes": []any{obj{"id": 106, "attributes": obj{"disabled": ""}}}}),
		mutation(ms(t, "2026-11-14T10:21:41.725Z"), obj{"attributes": []any{obj{"id": 106, "attributes": obj{"disabled": nil}}}}),
	)
}

func show(t *testing.T, body []byte, at string, form Form) string {
	t.Helper()
	text, err := PageText(body, ms(t, at), form)
	if err != nil {
		t.Fatal(err)
	}
	return text
}

func TestPrintsThePageAtTheReadMomentWithEveryChangeBeforeIt(t *testing.T) {
	got := show(t, wireOf(t, ms(t, "2026-11-14T10:21:40.450Z"), segRow(0, checkout(t, "Checkout"))), "2026-11-14T10:21:39.700Z", Outline)
	want := strings.Join([]string{
		`page 2026-11-14T10:21:40.450Z (--at +0.75s) url="/checkout"`,
		"main",
		`  h1 "Checkout"`,
		"  form#payment",
		`    label "Email"`,
		`      input name="email" type="email" value="********@*******"`,
		`    input name="card" type="text" value="****************"`,
		`    button type="submit" disabled "Pay now"`,
		`  div role="status" class="hidden"`,
		"",
	}, "\n")
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}

func TestSaysWhenTextWasMaskedAndHowFarAfterAtItRead(t *testing.T) {
	got := show(t, wireOf(t, ms(t, "2026-11-14T10:21:51.120Z"), segRow(0, checkout(t, "********"))), "2026-11-14T10:21:51.000Z", Outline)
	lines := strings.Split(got, "\n")
	if lines[0] != `page 2026-11-14T10:21:51.120Z (--at +0.12s) url="/checkout" text masked` {
		t.Fatalf("header %q", lines[0])
	}
	if !strings.Contains(got, "\n  h1\n") {
		t.Fatalf("got:\n%s", got)
	}
}

func TestGivesThePageAsHTMLOnRequest(t *testing.T) {
	got := show(t, wireOf(t, ms(t, "2026-11-14T10:21:42.480Z"), segRow(0, checkout(t, "Checkout"))), "2026-11-14T10:21:41.730Z", HTML)
	if !strings.HasPrefix(got, "page 2026-11-14T10:21:42.480Z (--at +0.75s) url=\"/checkout\"\n") || !strings.Contains(got, "<span>Pay now</span>") {
		t.Fatalf("got:\n%s", got)
	}
}

func TestReadsAnEventSplitAcrossSegments(t *testing.T) {
	start := ms(t, checkoutStart)
	rows := pieceRows(0, "0", toJSON(t, snapshot(start+10, formSnapshot())), 4)
	rows = append(rows, pieceRows(4, "", body(t, meta(start, "https://shop.example/x")), 1)...)
	got := show(t, wireOf(t, start+1_000, rows...), checkoutStart, Outline)
	if !strings.HasPrefix(got, "page 2026-11-14T10:20:42.120Z (--at +1.00s) url=\"/x\"\n") || !strings.Contains(got, `button#pay "Pay now"`) {
		t.Fatalf("got:\n%s", got)
	}
}

func TestMarksThePageIncompleteWhenTheReadHasAGap(t *testing.T) {
	start := ms(t, checkoutStart)
	got := show(t, wireOf(t, start+1_000, segRow(0, body(t, snapshot(start+10, formSnapshot()))), segRow(2, "[]")), checkoutStart, Outline)
	if header, _, _ := strings.Cut(got, "\n"); !strings.HasSuffix(header, " coverage incomplete") {
		t.Fatalf("header %q", header)
	}
	got = show(t, wireOf(t, start+1_000, segRow(0, "[]")), checkoutStart, Outline)
	if want := "page 2026-11-14T10:20:42.120Z (--at +1.00s) url=\"\" coverage incomplete\n(empty: no full snapshot before this moment)\n"; got != want {
		t.Fatalf("got %q", got)
	}
}
