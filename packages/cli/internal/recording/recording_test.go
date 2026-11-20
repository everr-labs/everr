package recording

import (
	"fmt"
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

func TestReadsAClipThatOpensAndClosesWithEmptySegmentsAsComplete(t *testing.T) {
	start := ms(t, checkoutStart)
	got := show(t, wireOf(t, start+1_000,
		segRow(0, "[]"), segRow(1, body(t, snapshot(start+10, formSnapshot()))), segRow(2, "[]"), segRow(3, "[]"),
	), checkoutStart, Outline)
	if header, _, _ := strings.Cut(got, "\n"); strings.Contains(header, "coverage incomplete") || !strings.Contains(got, `button#pay "Pay now"`) {
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

func TestMarksThePageIncompleteWhenALaterSnapshotCannotBeRead(t *testing.T) {
	start := ms(t, checkoutStart)
	broken := obj{"type": 2, "timestamp": start + 500, "data": obj{}}
	got := show(t, wireOf(t, start+1_000, segRow(0, body(t, snapshot(start+10, formSnapshot()), broken))), checkoutStart, Outline)
	if header, _, _ := strings.Cut(got, "\n"); !strings.HasSuffix(header, " coverage incomplete") {
		t.Fatalf("header %q", header)
	}
	got = show(t, wireOf(t, start+1_000, segRow(0, body(t, snapshot(start+10, formSnapshot()), broken, snapshot(start+600, formSnapshot())))), checkoutStart, Outline)
	if header, _, _ := strings.Cut(got, "\n"); strings.Contains(header, "coverage incomplete") {
		t.Fatalf("a later whole snapshot covers the page again: header %q", header)
	}
}

func TestReadsGenerationsInTimeOrderWhenTheyWereSentOutOfOrder(t *testing.T) {
	generation := func(at int64, heading string) string {
		page := obj{"type": 0, "id": at, "childNodes": []any{elID("html", obj{}, []any{
			elID("body", obj{}, []any{
				elID("h1", obj{}, []any{textID(heading, at+3)}, at+2),
			}, at+1),
		}, at+4)}}
		return body(t, meta(at, "https://x/p"), snapshot(at+1, page))
	}
	got := show(t, wireOf(t, 5_500,
		segRow(10, generation(5_000, "Five")),
		segRow(11, generation(3_000, "Three")),
		segRow(12, generation(4_000, "Four")),
	), "1970-01-01T00:00:04.750Z", Outline)
	if !strings.Contains(got, `"Five"`) || strings.Contains(got, "coverage incomplete") {
		t.Fatalf("got:\n%s", got)
	}
}

func TestMarksThePageIncompleteWhenAddsWaitForTheirParentsBeyondTheWorkOfARead(t *testing.T) {
	// Each add names the one after it as its parent, so one pass of retries
	// places a single node: about 20 million attempts per event of this size.
	const adds = 6300
	reversed := func(first int64) obj {
		list := make([]any, adds)
		for i := range list {
			parent := first + int64(i) + 1
			if i == adds-1 {
				parent = 4
			}
			list[i] = obj{"parentId": parent, "nextId": nil, "node": obj{"type": 2, "tagName": "b", "id": first + int64(i), "attributes": obj{}, "childNodes": []any{}}}
		}
		return obj{"adds": list}
	}
	events := []any{meta(1_000, "https://x/p"), snapshot(1_001, doc())}
	for i := range 2 {
		events = append(events, mutation(1_002+int64(i), reversed(100_000*int64(i+1))))
	}
	got := show(t, wireOf(t, 2_000, segRow(0, body(t, events...))), "1970-01-01T00:00:02Z", Outline)
	if header, _, _ := strings.Cut(got, "\n"); !strings.HasSuffix(header, " coverage incomplete") {
		t.Fatalf("header %q", header)
	}
}

// Hostile pages that fit the server's read limit. Each benchmark is one read
// through PageText: `go test -run xxx -bench Hostile -benchtime 1x`.

func attrNames(n int) obj {
	attrs := make(obj, n)
	for i := range n {
		attrs[fmt.Sprintf("a%07d", i)] = "v"
	}
	return attrs
}

func hostileRead(b *testing.B, events ...any) {
	b.Helper()
	data := wireOf(b, 10_000, segRow(0, body(b, events...)))
	b.ResetTimer()
	for range b.N {
		if _, err := PageText(data, 10_000, Outline); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkHostileSetEveryAttribute(b *testing.B) {
	const n = 100_000
	changed := make(obj, n)
	for name := range attrNames(n) {
		changed[name] = "w"
	}
	hostileRead(b,
		meta(1_000, "https://x/p"),
		snapshot(1_001, doc(elID("div", attrNames(n), nil, 5))),
		mutation(1_002, obj{"attributes": []any{obj{"id": 5, "attributes": changed}}}),
	)
}

func BenchmarkHostileAddAttributes(b *testing.B) {
	const n = 100_000
	hostileRead(b,
		meta(1_000, "https://x/p"),
		snapshot(1_001, doc(elID("div", obj{}, nil, 5))),
		mutation(1_002, obj{"attributes": []any{obj{"id": 5, "attributes": attrNames(n)}}}),
	)
}

func BenchmarkHostileInputsOnABigNode(b *testing.B) {
	const n = 200_000
	events := []any{meta(1_000, "https://x/p"), snapshot(1_001, doc(elID("input", attrNames(n), nil, 5)))}
	for i := range 50_000 {
		events = append(events, input(1_002+int64(i%100), 5, "typed"))
	}
	hostileRead(b, events...)
}

func custom(at int64, tag string) obj {
	return obj{"type": 5, "timestamp": at, "data": obj{"tag": tag, "payload": obj{}}}
}

func headerAt(t *testing.T, readMs int64, events ...any) string {
	t.Helper()
	got, err := PageText(wireOf(t, readMs, segRow(0, body(t, events...))), readMs, Outline)
	if err != nil {
		t.Fatal(err)
	}
	header, _, _ := strings.Cut(got, "\n")
	return header
}

func TestSaysWhenTheRecorderWasPausedAtTheMomentAndSince(t *testing.T) {
	page := func(h string) obj { return doc(el("h1", obj{}, text(h))) }
	events := []any{
		meta(1_000, "https://x/a"), snapshot(1_001, page("Before")),
		custom(2_000, "everr.recording.pause"),
		custom(3_000, "everr.recording.pause"), // already paused: the first one counts
		custom(60_000, "everr.recording.resume"),
		meta(60_001, "https://x/b"), snapshot(60_002, page("After")),
		custom(70_000, "everr.recording.pause"),
	}
	for _, c := range []struct {
		readMs int64
		want   string
	}{
		{1_500, `page 1970-01-01T00:00:01.500Z (--at +0.00s) url="/a"`},
		{2_000, `page 1970-01-01T00:00:02.000Z (--at +0.00s) url="/a" recording paused since 1970-01-01T00:00:02.000Z`},
		{29_000, `page 1970-01-01T00:00:29.000Z (--at +0.00s) url="/a" recording paused since 1970-01-01T00:00:02.000Z`},
		// Resumed, but the page is the old one until the snapshot that follows.
		{60_000, `page 1970-01-01T00:01:00.000Z (--at +0.00s) url="/a" recording paused since 1970-01-01T00:00:02.000Z`},
		{60_500, `page 1970-01-01T00:01:00.500Z (--at +0.00s) url="/b"`},
		{70_000, `page 1970-01-01T00:01:10.000Z (--at +0.00s) url="/b" recording paused since 1970-01-01T00:01:10.000Z`},
	} {
		if got := headerAt(t, c.readMs, events...); got != c.want {
			t.Errorf("read at %d:\n got %s\nwant %s", c.readMs, got, c.want)
		}
	}
}

func TestAFullSnapshotEndsAPauseEvenWithNoResumeMarker(t *testing.T) {
	got := headerAt(t, 5_000, meta(1_000, "https://x/a"), snapshot(1_001, doc()), custom(2_000, "everr.recording.pause"), snapshot(3_000, doc()))
	if strings.Contains(got, "paused") {
		t.Fatalf("header %q", got)
	}
}

func TestTakesTheURLOfAMetaOnlyWhenItsSnapshotIsApplied(t *testing.T) {
	events := []any{
		meta(1_000, "https://x/a"), snapshot(1_001, doc()),
		meta(5_000, "https://x/b"), snapshot(5_010, doc()),
		meta(9_000, "https://x/c"), obj{"type": 2, "timestamp": 9_010, "data": obj{}},
	}
	for readMs, want := range map[int64]string{
		1_500: `"/a"`, 5_000: `"/a"`, 5_009: `"/a"`, 5_010: `"/b"`, 9_500: `"/b"`,
	} {
		if got := headerAt(t, readMs, events...); !strings.Contains(got, "url="+want+" ") && !strings.HasSuffix(got, "url="+want) {
			t.Errorf("read at %d: %s, want url=%s", readMs, got, want)
		}
	}
}

func manyLongAttributes(n int) obj {
	attrs := obj{}
	for i := range n {
		attrs[fmt.Sprintf("data-%03d", i)] = strings.Repeat("x", 200)
	}
	return attrs
}

func htmlOf(t *testing.T, page obj) []string {
	t.Helper()
	got := show(t, wireOf(t, 10_000, segRow(0, body(t, meta(1_000, "https://x/p"), snapshot(1_001, page)))), "1970-01-01T00:00:09.250Z", HTML)
	return strings.Split(strings.TrimRight(got, "\n"), "\n")[1:]
}

func TestHTMLCapsWhatOneElementPrintsSoTheDepthStillFits(t *testing.T) {
	lines := htmlOf(t, doc(
		el("div", manyLongAttributes(90)),
		el("main", obj{}, el("h1", obj{}, text("Checkout"))),
	))
	if len(lines) != 6 || !strings.HasPrefix(lines[1], "  <div data-000=") || lines[2] != "  <main>" || lines[3] != "    <h1>Checkout</h1>" {
		t.Fatalf("lines:\n%s", strings.Join(lines, "\n"))
	}
	if !strings.HasSuffix(lines[1], " more attributes></div>") || len(lines[1]) > 3_000 {
		t.Fatalf("div line (%d chars): ...%s", len(lines[1]), lines[1][max(0, len(lines[1])-60):])
	}
}

func TestHTMLNeverCutsBetweenAnOpeningTagAndItsClosingTag(t *testing.T) {
	var sections []any
	for range 12 {
		sections = append(sections, el("section", manyLongAttributes(90), el("p", obj{}, text("x"))))
	}
	lines := htmlOf(t, obj{"type": 0, "id": 1, "childNodes": sections})
	opened, closed := 0, 0
	for _, line := range lines {
		switch {
		case strings.HasPrefix(line, "<section"):
			opened++
		case line == "</section>":
			closed++
		}
	}
	last := lines[len(lines)-1]
	if opened == 0 || opened != closed || !strings.HasPrefix(last, "... ") || !strings.HasSuffix(last, " more lines") {
		t.Fatalf("%d opened, %d closed, last %q", opened, closed, last)
	}
}

func TestKeepsAttributeOrderAndValuesOnANodeWithManyAttributes(t *testing.T) {
	names := func(from, to int) obj {
		out := obj{}
		for i := from; i < to; i++ {
			out[fmt.Sprintf("a%02d", i)] = "v"
		}
		return out
	}
	nulls := func(from, to int, keep int) obj {
		out := obj{}
		for i := from; i < to; i++ {
			if i != keep {
				out[fmt.Sprintf("a%02d", i)] = nil
			}
		}
		return out
	}
	change := func(at int64, attributes obj) obj {
		return mutation(at, obj{"attributes": []any{obj{"id": 5, "attributes": attributes}}})
	}
	read := func(events ...any) string {
		all := append([]any{meta(1_000, "https://x/p"), snapshot(1_001, doc(elID("div", names(0, 40), nil, 5)))}, events...)
		got := show(t, wireOf(t, 10_000, segRow(0, body(t, all...))), "1970-01-01T00:00:09.250Z", HTML)
		return strings.Split(got, "\n")[2]
	}
	// Removing from the middle keeps the rest in order, and a re-added name goes last.
	got := read(
		change(1_002, nulls(10, 40, 20)),
		change(1_003, obj{"a03": "new", "a12": "again", "z1": "z"}),
		change(1_004, obj{"a00": nil}),
	)
	want := `  <div a01="v" a02="v" a03="new" a04="v" a05="v" a06="v" a07="v" a08="v" a09="v" a20="v" a12="again" z1="z"></div>`
	if got != want {
		t.Fatalf("got  %s\nwant %s", got, want)
	}

	// Setting a name to another value keeps its place; removing a name that is not there changes nothing.
	got = read(change(1_002, obj{"a39": "w", "missing": nil}), change(1_003, nulls(0, 38, -1)))
	if want := `  <div a38="v" a39="w"></div>`; got != want {
		t.Fatalf("got  %s\nwant %s", got, want)
	}

	// Input events set value and checked on the same list.
	got = read(input(1_002, 5, "typed"), obj{"type": 3, "timestamp": 1_003, "data": obj{"source": 5, "id": 5, "text": "again", "isChecked": true}}, change(1_004, nulls(0, 37, -1)))
	if want := `  <div a37="v" a38="v" a39="v" value="again" checked=""></div>`; got != want {
		t.Fatalf("got  %s\nwant %s", got, want)
	}
}

func TestChangesEveryAttributeOfANodeWithTwoHundredThousand(t *testing.T) {
	const n = 200_000
	renamed := make(obj, n)
	for name := range attrNames(n) {
		renamed[name] = nil
	}
	renamed["a0000042"] = "kept"
	renamed["fresh"] = "new"
	got := show(t, wireOf(t, 10_000, segRow(0, body(t,
		meta(1_000, "https://x/p"),
		snapshot(1_001, doc(elID("div", attrNames(n), nil, 5))),
		mutation(1_002, obj{"attributes": []any{obj{"id": 5, "attributes": renamed}}}),
	))), "1970-01-01T00:00:09.250Z", HTML)
	if want := `  <div a0000042="kept" fresh="new"></div>`; strings.Split(got, "\n")[2] != want {
		t.Fatalf("got:\n%s", got)
	}
}

func TestPlacesAddsThatArriveBeforeTheirParentsWhateverElseTheyCarry(t *testing.T) {
	read := func(adds []any) string {
		return show(t, wireOf(t, 10_000, segRow(0, body(t, meta(1_000, "https://x/p"), snapshot(1_001, doc()), mutation(1_002, obj{"adds": adds})))), "1970-01-01T00:00:09.250Z", HTML)
	}
	got := read(reversedAdds(300)[6250:])
	if strings.Contains(got, "coverage incomplete") || strings.Count(got, "<b>") != 50 {
		t.Fatalf("got:\n%s", got)
	}
	// An add with no nextId has no place, as in rrweb.
	adds := reversedAdds(0)[6299:]
	delete(adds[0].(obj), "nextId")
	if got := read(adds); !strings.Contains(got, "coverage incomplete") || strings.Contains(got, "<b>") {
		t.Fatalf("got:\n%s", got)
	}
}

// Adds that name the add after them wait through every pass of the retry loop.
func reversedAdds(junk int) []any {
	const adds = 6300
	list := make([]any, adds)
	for i := range list {
		parent := 100_000 + int64(i) + 1
		if i == adds-1 {
			parent = 4
		}
		add := obj{"parentId": parent, "nextId": nil, "node": obj{"type": 2, "tagName": "b", "id": 100_000 + int64(i), "attributes": obj{}, "childNodes": []any{}}}
		for k := range junk {
			add[fmt.Sprintf("junk%04d", k)] = 1
		}
		list[i] = add
	}
	return list
}

func BenchmarkHostileReversedAdds(b *testing.B) {
	hostileRead(b, meta(1_000, "https://x/p"), snapshot(1_001, doc()), mutation(1_002, obj{"adds": reversedAdds(0)}))
}

func BenchmarkHostileReversedAddsPaddedWithKeys(b *testing.B) {
	hostileRead(b, meta(1_000, "https://x/p"), snapshot(1_001, doc()), mutation(1_002, obj{"adds": reversedAdds(620)}))
}

func TestHTMLPrintsAtMostSixteenShortAttributesAndSaysHowManyWereCut(t *testing.T) {
	attrs := obj{}
	for i := range 40 {
		attrs[fmt.Sprintf("a%02d", i)] = "v"
	}
	lines := htmlOf(t, doc(el("p", attrs)))
	if want := `  <p a00="v" a01="v" a02="v" a03="v" a04="v" a05="v" a06="v" a07="v" a08="v" a09="v" a10="v" a11="v" a12="v" a13="v" a14="v" a15="v" ... 24 more attributes></p>`; lines[1] != want {
		t.Fatalf("got %s", lines[1])
	}
}
