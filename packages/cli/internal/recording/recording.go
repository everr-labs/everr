// Package recording implements `everr cloud recording show`: the page of a
// recorded browser visit just after a moment, rebuilt here from its Segments.
//
// `GET /api/cli/recordings/segments` finds the Clip covering `--at` and sends
// its Segments up to the moment the page is read, unparsed (wire.go). This
// package puts the rrweb events back together (events.go), replays them into
// a page (mirror.go), and prints it (render.go). Browsers write Recordings, so
// a large or hostile one costs this process alone, and every step is bounded:
// JSON nests at most maxDepth, a read parses at most maxValues values, the page
// is walked in loops, and the views stop at maxViewDepth.
package recording

// PageText is the `show` text for the body of a segments response: the page
// at the server's read moment, every event up to it replayed, then one view of
// the result. atMs is the moment asked for.
func PageText(body []byte, atMs int64, form Form) (string, error) {
	w, err := readWire(body)
	if err != nil {
		return "", err
	}
	events, gap := reassemble(w.rows, maxValues)
	m := newMirror()
	pageURL := ""
	for _, e := range events {
		if e.timestamp > float64(w.readMs) {
			break
		}
		if e.kind == eventMeta {
			if href, ok := e.data.get("href").str(); ok {
				pageURL = href
			}
		}
		m.apply(e)
	}
	view := m.view(form)
	complete := m.loaded() && !m.lost && !gap
	return pageText(w.readMs, atMs, pageURL, view, complete), nil
}
