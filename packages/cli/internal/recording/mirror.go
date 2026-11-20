package recording

// A minimal rrweb DOM. It loads a full snapshot, then applies the incremental
// events after it by node id, as the rrweb replayer does: in each mutation the
// removes first, then the adds, the texts, and the attributes; an input event
// sets the value of its node. It knows nothing of layout or styles: it gives
// the page at an instant, as an outline or as HTML.
//
// Nodes live in an arena with sibling links, so a change costs the same on a
// node with a million siblings, and every walk over the tree is a loop: a
// Recording can build a page as deep as it likes. The views stop at
// maxViewDepth.

import (
	"fmt"
	"math"
	"slices"
	"strings"
	"unicode/utf16"
)

// rrweb NodeType values the mirror reads.
const (
	nodeDocument = 0
	nodeElement  = 2
	nodeText     = 3
)

// rrweb EventType values.
const (
	eventFullSnapshot = 2
	eventIncremental  = 3
	eventMeta         = 4
)

// rrweb IncrementalSource values.
const (
	sourceMutation = 0
	sourceInput    = 5
)

var (
	voidTags = []string{
		"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
		"track", "wbr",
	}
	// Left out of every view: they hold no content a reader of the page sees.
	compactSkip = []string{"head", "script", "style", "noscript", "template", "link", "meta"}
	// Shown in the outline even with no naming attribute or text of their own.
	semanticTags = []string{
		"main", "nav", "header", "footer", "aside", "section", "article", "dialog", "form", "fieldset",
		"legend", "label", "input", "select", "textarea", "button", "a", "details", "summary",
		"option", "h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li", "table", "tr", "th", "td",
		"iframe", "video", "audio", "progress",
	}
	// Their text names them: the outline prints all of it and none of their descendants.
	textNamed = []string{"a", "button", "summary", "option", "h1", "h2", "h3", "h4", "h5", "h6", "legend"}
	// A class token worth printing names a state.
	stateWords = []string{"error", "invalid", "disabled", "loading", "active", "open", "selected", "hidden"}
)

const (
	// A parent shows this many children, then one marker line.
	maxChildren = 12
	// Attribute values and text in the HTML form stop here.
	htmlValueCap = 200
	// totalLines stops counting here.
	countCap = 50_000
	// The views do not go below this depth: no budget prints a page that deep.
	maxViewDepth = 512
	// An add waits for its parent and next sibling, retried pass after pass as
	// rrweb does. This bounds the attempts of a whole read, not of one mutation.
	maxAddAttempts = 20_000_000
)

// Form is the view `recording show` prints.
type Form int

const (
	Outline Form = iota
	HTML
)

type budget struct {
	lines int
	chars int
}

func (f Form) budget() budget {
	if f == HTML {
		return budget{lines: 160, chars: 16_000}
	}
	return budget{lines: 100, chars: 12_000}
}

// pageView is the page as lines. Lines are whole: a budget never cuts inside
// one. totalLines is what the page takes without a budget. masked: the
// outline left out text or attribute values the SDK Masked.
type pageView struct {
	lines      []string
	totalLines int
	masked     bool
}

const none = -1

// node is a node as rrweb serializes it, linked to its parent and siblings.
type node struct {
	kind  float64 // NaN when the node has none
	rrID  int64
	hasID bool
	tag   string
	attrs attrList
	text  string

	parent, first, last, prev, next int
}

type mirror struct {
	nodes []node
	ids   map[int64]int
	root  int
	// lost is true once an event referred to a node the mirror did not have.
	lost bool
	// addAttempts counts every try to place an add, over snapshots too.
	addAttempts int
}

func newMirror() *mirror {
	return &mirror{ids: map[int64]int{}, root: none}
}

// viewItem is a line of a view and what is under it. total is the lines it
// takes with no budget.
type viewItem struct {
	open     string
	close    string
	hasClose bool
	children []viewItem
	total    int
}

func line(open string) viewItem { return viewItem{open: open, total: 1} }

func isSnapNode(value Json) bool {
	_, ok := value.get("type").num()
	return ok
}

// attrList is a node's attributes in the order they were first set, as --html
// prints them. A list longer than linearKeys finds a name through an index, so
// n changes to one node cost n, not n squared. A removal from an indexed list
// leaves a hole; the holes are swept once they outnumber the live entries.
type attrList struct {
	items []member
	// gone marks the holes; nil until a removal from an indexed list.
	gone  []bool
	index map[string]int
	holes int
}

func (l *attrList) live(i int) bool { return l.gone == nil || !l.gone[i] }

// indexed makes the index of a list long enough to need one.
func (l *attrList) indexed() {
	if l.index != nil || len(l.items) <= linearKeys {
		return
	}
	l.index = make(map[string]int, len(l.items))
	for i := range l.items {
		l.index[l.items[i].key] = i
	}
}

// at is the place of name, or -1. It scans a list with no index: a view reads
// each element once, and an index per element would cost more than it saves.
func (l *attrList) at(name string) int {
	if l.index != nil {
		if i, ok := l.index[name]; ok {
			return i
		}
		return -1
	}
	for i := range l.items {
		if l.items[i].key == name {
			return i
		}
	}
	return -1
}

func (l *attrList) get(name string) *Json {
	if i := l.at(name); i >= 0 {
		return &l.items[i].value
	}
	return nil
}

func (l *attrList) set(name string, value Json) {
	l.indexed()
	if i := l.at(name); i >= 0 {
		l.items[i].value = value
		return
	}
	l.items = append(l.items, member{key: name, value: value})
	if l.gone != nil {
		l.gone = append(l.gone, false)
	}
	if l.index != nil {
		l.index[name] = len(l.items) - 1
	}
}

func (l *attrList) remove(name string) {
	l.indexed()
	i := l.at(name)
	if i < 0 {
		return
	}
	if l.index == nil {
		l.items = slices.Delete(l.items, i, i+1)
		return
	}
	if l.gone == nil {
		l.gone = make([]bool, len(l.items))
	}
	delete(l.index, name)
	l.gone[i] = true
	l.items[i] = member{}
	if l.holes++; l.holes*2 > len(l.items) {
		l.sweep()
	}
}

func (l *attrList) sweep() {
	kept := l.items[:0]
	for i := range l.items {
		if l.gone[i] {
			continue
		}
		kept = append(kept, l.items[i])
	}
	clear(l.items[len(kept):])
	l.items, l.gone, l.index, l.holes = kept, nil, nil, 0
	l.indexed()
}

// loaded reports whether a snapshot is loaded.
func (m *mirror) loaded() bool { return m.root != none }

// apply applies one rrweb event. A full snapshot starts the mirror over.
func (m *mirror) apply(e event) {
	data := e.data
	if e.kind == eventFullSnapshot {
		if snapshot, ok := data.take("node"); ok && isSnapNode(snapshot) {
			attempts := m.addAttempts
			*m = *newMirror()
			m.addAttempts = attempts
			m.root = m.build(snapshot)
			if m.root != none {
				m.index(m.root)
			}
		} else {
			// The page it replaced stays, and no longer covers the moment.
			m.lost = true
		}
		return
	}
	if m.root == none || e.kind != eventIncremental {
		return
	}
	source, ok := data.get("source").num()
	switch {
	case ok && source == sourceMutation:
		m.mutate(data)
	case ok && source == sourceInput:
		m.input(data)
	}
}

func (m *mirror) children(id int) []int {
	var out []int
	for child := m.nodes[id].first; child != none; child = m.nodes[child].next {
		out = append(out, child)
	}
	return out
}

// subtree gives every node of the subtree at id, id first.
func (m *mirror) subtree(id int) []int {
	var out []int
	stack := []int{id}
	for len(stack) > 0 {
		at := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		out = append(out, at)
		for child := m.nodes[at].first; child != none; child = m.nodes[child].next {
			stack = append(stack, child)
		}
	}
	return out
}

// build adds a serialized node and its descendants to the arena, unattached.
// Children that are not objects are left out.
func (m *mirror) build(value Json) int {
	root := none
	type pending struct {
		value  Json
		parent int
	}
	stack := []pending{{value, none}}
	for len(stack) > 0 {
		top := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		value := top.value
		if value.kind != jsonObj {
			continue
		}
		children, _ := value.take("childNodes")
		var attrs attrList
		if attributes, ok := value.take("attributes"); ok && attributes.kind == jsonObj {
			attrs.items = attributes.items
		}
		kind, ok := value.get("type").num()
		if !ok {
			kind = math.NaN()
		}
		rrID, hasID := value.get("id").id()
		tag, _ := value.get("tagName").str()
		text := ""
		if content, ok := value.take("textContent"); ok && content.kind == jsonStr {
			text = content.s
		}
		id := len(m.nodes)
		m.nodes = append(m.nodes, node{
			kind: kind, rrID: rrID, hasID: hasID, tag: tag, attrs: attrs, text: text,
			parent: none, first: none, last: none, prev: none, next: none,
		})
		if top.parent != none {
			m.insert(top.parent, id, none)
		} else {
			root = id
		}
		if children.kind == jsonArr {
			// Reversed, so they are popped, and appended, in order.
			for i := len(children.items) - 1; i >= 0; i-- {
				stack = append(stack, pending{children.items[i].value, id})
			}
		}
	}
	return root
}

// insert links an unattached node into parent, before `before` or last.
func (m *mirror) insert(parent, id, before int) {
	prev := m.nodes[parent].last
	if before != none {
		prev = m.nodes[before].prev
	}
	m.nodes[id].parent = parent
	m.nodes[id].prev = prev
	m.nodes[id].next = before
	if prev != none {
		m.nodes[prev].next = id
	} else {
		m.nodes[parent].first = id
	}
	if before != none {
		m.nodes[before].prev = id
	} else {
		m.nodes[parent].last = id
	}
}

// index makes the ids of the subtree at id name its nodes.
func (m *mirror) index(id int) {
	for _, at := range m.subtree(id) {
		if m.nodes[at].hasID {
			m.ids[m.nodes[at].rrID] = at
		}
	}
}

// detach takes a node out of the tree. False when the mirror does not have it
// in the tree.
func (m *mirror) detach(rrID int64) bool {
	id, ok := m.ids[rrID]
	if !ok {
		return false
	}
	parent := m.nodes[id].parent
	if parent == none {
		return false
	}
	prev, next := m.nodes[id].prev, m.nodes[id].next
	if prev != none {
		m.nodes[prev].next = next
	} else {
		m.nodes[parent].first = next
	}
	if next != none {
		m.nodes[next].prev = prev
	} else {
		m.nodes[parent].last = prev
	}
	m.nodes[id].parent, m.nodes[id].prev, m.nodes[id].next = none, none, none
	for _, at := range m.subtree(id) {
		if m.nodes[at].hasID {
			delete(m.ids, m.nodes[at].rrID)
		}
	}
	return true
}

func (m *mirror) nodeOf(value *Json, key string) (int, bool) {
	rrID, ok := value.get(key).id()
	if !ok {
		return none, false
	}
	id, ok := m.ids[rrID]
	return id, ok
}

// How an add names the node it goes before.
const (
	nextNever = iota // absent, or not an id: the add never has a place
	nextEnd          // null: last in its parent
	nextNode         // the node with id nextID
)

// pendingAdd is an add with its fields read once, so that each retry costs two
// lookups, not a scan of the keys of an object the page made as long as it likes.
type pendingAdd struct {
	parent    int64
	hasParent bool
	next      int
	nextID    int64
	node      Json
	nodeID    int64
	hasNodeID bool
}

func readAdd(add *Json) pendingAdd {
	var out pendingAdd
	out.parent, out.hasParent = add.get("parentId").id()
	if nextID := add.get("nextId"); nextID != nil {
		if nextID.kind == jsonNull {
			out.next = nextEnd
		} else if id, ok := nextID.id(); ok {
			out.next, out.nextID = nextNode, id
		}
	}
	out.node, _ = add.take("node")
	out.nodeID, out.hasNodeID = out.node.get("id").id()
	return out
}

func (m *mirror) mutate(data Json) {
	if removes, ok := data.take("removes"); ok && removes.kind == jsonArr {
		for i := range removes.items {
			rrID, ok := removes.items[i].value.get("id").id()
			if !ok || !m.detach(rrID) {
				m.lost = true
			}
		}
	}
	// An add can name a parent or a next sibling that a later add in the same
	// event creates. Retry until a pass makes no progress, as rrweb does.
	if adds, ok := data.take("adds"); ok && adds.kind == jsonArr {
		list := make([]pendingAdd, len(adds.items))
		pending := make([]int, len(list))
		for i := range adds.items {
			list[i] = readAdd(&adds.items[i].value)
			pending[i] = i
		}
		for len(pending) > 0 {
			var left []int
			for _, at := range pending {
				add := &list[at]
				m.addAttempts++
				parent, parentOK := m.ids[add.parent]
				parentOK = parentOK && add.hasParent
				next, nextOK := none, false
				switch add.next {
				case nextEnd:
					nextOK = true
				case nextNode:
					next, nextOK = m.ids[add.nextID]
				}
				if !parentOK || !nextOK {
					left = append(left, at)
					continue
				}
				// A node that is already in the tree moves.
				if add.hasNodeID {
					m.detach(add.nodeID)
				}
				built := m.build(add.node)
				if built == none {
					m.lost = true
					continue
				}
				before := none
				if next != none && m.nodes[next].parent == parent {
					before = next
				}
				m.insert(parent, built, before)
				m.index(built)
			}
			if len(left) == 0 {
				break
			}
			if len(left) == len(pending) || m.addAttempts > maxAddAttempts {
				m.lost = true
				break
			}
			pending = left
		}
	}
	if texts, ok := data.take("texts"); ok && texts.kind == jsonArr {
		for i := range texts.items {
			change := &texts.items[i].value
			id, ok := m.nodeOf(change, "id")
			if !ok {
				m.lost = true
				continue
			}
			value, _ := change.take("value")
			m.nodes[id].text = ""
			if value.kind == jsonStr {
				m.nodes[id].text = value.s
			}
		}
	}
	if changes, ok := data.take("attributes"); ok && changes.kind == jsonArr {
		for i := range changes.items {
			change := &changes.items[i].value
			id, ok := m.nodeOf(change, "id")
			if !ok {
				m.lost = true
				continue
			}
			attributes, ok := change.take("attributes")
			if !ok || attributes.kind != jsonObj {
				continue
			}
			for _, attribute := range attributes.items {
				switch {
				case attribute.value.kind == jsonNull:
					m.nodes[id].attrs.remove(attribute.key)
				case attribute.value.kind == jsonObj && attribute.key == "style":
					// A style diff: no view shows style, so it is not applied.
				default:
					m.nodes[id].attrs.set(attribute.key, attribute.value)
				}
			}
		}
	}
}

func (m *mirror) input(data Json) {
	if _, ok := data.get("id").num(); !ok {
		return
	}
	id, ok := m.nodeOf(&data, "id")
	if !ok {
		m.lost = true
		return
	}
	if text, ok := data.take("text"); ok && text.kind == jsonStr {
		m.nodes[id].attrs.set("value", text)
	}
	if checked := data.get("isChecked"); checked != nil && checked.kind == jsonBool {
		if checked.b {
			m.nodes[id].attrs.set("checked", jsonString(""))
		} else {
			m.nodes[id].attrs.remove("checked")
		}
	}
}

// view gives the page as bounded lines. Outline: semantic elements with their
// naming attributes, state, and text. HTML: the body, one element per line,
// as recorded. Both keep their structure under the budget (see fit).
func (m *mirror) view(form Form) pageView {
	if m.root == none {
		return pageView{}
	}
	masked := false
	var items []viewItem
	if form == HTML {
		items = m.html(m.root, 0)
	} else {
		items = collapseRuns(m.outline(m.root, 0, &masked))
	}
	lines, total := fit(items, form.budget())
	return pageView{lines: lines, totalLines: total, masked: masked}
}

func (m *mirror) stringAttr(id int, name string) string {
	s, _ := m.nodes[id].attrs.get(name).str()
	return s
}

func (m *mirror) hasAttr(id int, name string) bool {
	return m.nodes[id].attrs.get(name) != nil
}

func (m *mirror) tagOf(id int) string {
	tag := strings.ToLower(m.nodes[id].tag)
	valid := tag != "" && len(tag) <= 32 && tag[0] >= 'a' && tag[0] <= 'z'
	for i := 1; valid && i < len(tag); i++ {
		c := tag[i]
		valid = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-'
	}
	if !valid {
		return "element"
	}
	return tag
}

// textOf gives the start of the text of a node, its whitespace collapsed. It
// stops past max, so a large element does not walk the page.
func (m *mirror) textOf(id, max int) string {
	var out strings.Builder
	length := 0
	stack := []int{id}
	for len(stack) > 0 && length <= max {
		at := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if m.nodes[at].kind == nodeText {
			text := collapse(m.nodes[at].text)
			if text != "" {
				if out.Len() > 0 {
					out.WriteByte(' ')
					length++
				}
				length += utf16Len(text)
				out.WriteString(text)
			}
			continue
		}
		children := m.children(at)
		for i := len(children) - 1; i >= 0; i-- {
			stack = append(stack, children[i])
		}
	}
	return out.String()
}

func (m *mirror) outlineChildren(id, depth int, masked *bool) []viewItem {
	var items []viewItem
	for child := m.nodes[id].first; child != none; child = m.nodes[child].next {
		items = append(items, m.outline(child, depth+1, masked)...)
	}
	return items
}

// outline: semantic elements only, one per line: `tag#id`, the naming
// attributes and state, then the element's text, quoted. A wrapper with
// nothing to name it is flattened into its parent. Masked text and attributes
// are left out; a Masked input value stays, as its length says whether the
// field was filled.
func (m *mirror) outline(id, depth int, masked *bool) []viewItem {
	if depth > maxViewDepth {
		return nil
	}
	kind := m.nodes[id].kind
	if kind == nodeDocument {
		return m.outlineChildren(id, depth, masked)
	}
	if kind != nodeElement {
		return nil
	}
	tag := m.tagOf(id)
	if slices.Contains(compactSkip, tag) || (tag == "input" && m.stringAttr(id, "type") == "hidden") {
		return nil
	}
	if tag == "html" || tag == "body" {
		return m.outlineChildren(id, depth, masked)
	}
	idAttr := m.stringAttr(id, "id")
	head := tag
	if bareID(idAttr) {
		head = tag + "#" + idAttr
	}
	var parts []string
	add := func(key, value string, max int) { parts = addPart(parts, masked, key, value, max) }
	if head == tag {
		add("id", idAttr, textCap)
	}
	add("testid", m.stringAttr(id, "data-testid"), textCap)
	add("name", m.stringAttr(id, "name"), textCap)
	add("type", m.stringAttr(id, "type"), textCap)
	add("role", m.stringAttr(id, "role"), textCap)
	label := m.stringAttr(id, "aria-label")
	if label == "" {
		label = m.stringAttr(id, "alt")
	}
	add("label", label, textCap)
	if tag == "a" {
		href := m.stringAttr(id, "href")
		if cut := strings.IndexAny(href, "?#"); cut >= 0 {
			href = href[:cut]
		}
		add("href", href, urlCap)
	}
	if value := m.stringAttr(id, "value"); value != "" && (tag == "input" || tag == "textarea" || tag == "select") {
		parts = append(parts, "value="+q(value, textCap))
	}
	var states []string
	for _, token := range strings.FieldsFunc(m.stringAttr(id, "class"), jsSpace) {
		if stateClass(token) {
			states = append(states, token)
		}
	}
	add("class", strings.Join(states, " "), textCap)
	if m.hasAttr(id, "disabled") {
		parts = append(parts, "disabled")
	}
	if m.hasAttr(id, "checked") {
		parts = append(parts, "checked")
	}
	named := slices.Contains(textNamed, tag)
	var text string
	if named {
		text = m.textOf(id, textCap)
	} else {
		var texts []string
		for child := m.nodes[id].first; child != none; child = m.nodes[child].next {
			if m.nodes[child].kind == nodeText {
				texts = append(texts, m.nodes[child].text)
			}
		}
		text = collapse(strings.Join(texts, " "))
	}
	add("", text, textCap)
	var kids []viewItem
	if !named && tag != "svg" {
		kids = collapseRuns(m.outlineChildren(id, depth, masked))
	}
	if len(parts) == 0 && head == tag && !slices.Contains(semanticTags, tag) {
		return kids
	}
	total := 1
	for _, kid := range kids {
		total += kid.total
	}
	return []viewItem{{
		open:     strings.Join(append([]string{head}, parts...), " "),
		children: kids,
		total:    total,
	}}
}

func (m *mirror) htmlChildren(id, depth int) []viewItem {
	var items []viewItem
	for child := m.nodes[id].first; child != none; child = m.nodes[child].next {
		items = append(items, m.html(child, depth+1)...)
	}
	return items
}

// html: the body as compact HTML (no head, script, style, inline style, svg
// content, or rrweb attributes), one element per line.
func (m *mirror) html(id, depth int) []viewItem {
	if depth > maxViewDepth {
		return nil
	}
	n := &m.nodes[id]
	if n.kind == nodeText {
		text := collapse(n.text)
		if text == "" {
			return nil
		}
		return []viewItem{line(escapeHTML(capText(text, htmlValueCap)))}
	}
	if n.kind == nodeDocument {
		return m.htmlChildren(id, depth)
	}
	if n.kind != nodeElement {
		return nil
	}
	tag := m.tagOf(id)
	if slices.Contains(compactSkip, tag) {
		return nil
	}
	if tag == "html" {
		return m.htmlChildren(id, depth)
	}
	var attrs strings.Builder
	for i := range n.attrs.items {
		if !n.attrs.live(i) {
			continue
		}
		name := n.attrs.items[i].key
		// rrweb's own attributes (rr_width, _cssText, ...) are replay hints.
		if strings.HasPrefix(name, "rr_") || strings.HasPrefix(name, "_") || name == "style" {
			continue
		}
		value := escapeHTML(capText(n.attrs.items[i].value.jsString(), htmlValueCap))
		value = strings.NewReplacer("\r", "&#10;", "\n", "&#10;").Replace(value)
		fmt.Fprintf(&attrs, " %s=\"%s\"", escapeHTML(name), value)
	}
	// An <svg> is drawing, not content: the element only.
	if tag == "svg" {
		return []viewItem{line("<svg" + attrs.String() + "></svg>")}
	}
	if slices.Contains(voidTags, tag) {
		return []viewItem{line("<" + tag + attrs.String() + ">")}
	}
	kids := m.htmlChildren(id, depth)
	// Only text inside: one line.
	onlyText := true
	for child := m.nodes[id].first; child != none; child = m.nodes[child].next {
		if m.nodes[child].kind == nodeElement {
			onlyText = false
			break
		}
	}
	if onlyText && len(kids) <= 1 {
		inner := ""
		if len(kids) == 1 {
			inner = kids[0].open
		}
		return []viewItem{line("<" + tag + attrs.String() + ">" + inner + "</" + tag + ">")}
	}
	total := 2
	for _, kid := range kids {
		total += kid.total
	}
	return []viewItem{{
		open:     "<" + tag + attrs.String() + ">",
		close:    "</" + tag + ">",
		hasClose: true,
		children: kids,
		total:    total,
	}}
}

// bareID: an id printed bare after the tag (`button#pay`); any other id is quoted.
func bareID(id string) bool {
	if id == "" || len(id) > 64 || !isASCIILetter(id[0]) {
		return false
	}
	for i := 1; i < len(id); i++ {
		c := id[i]
		if !isASCIILetter(c) && !(c >= '0' && c <= '9') && c != '_' && c != '-' {
			return false
		}
	}
	return true
}

func isASCIILetter(c byte) bool { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') }

// addPart adds `key="value"` (or the quoted value alone) to an outline line.
// A Masked value is left out and noted.
func addPart(parts []string, masked *bool, key, value string, max int) []string {
	switch {
	case value == "":
	case isMasked(value):
		*masked = true
	case key == "":
		parts = append(parts, q(value, max))
	default:
		parts = append(parts, key+"="+q(value, max))
	}
	return parts
}

// isMasked: a Masked text or value is asterisks and whitespace: it names nothing.
func isMasked(value string) bool {
	for _, c := range value {
		if c != '*' && !jsSpace(c) {
			return false
		}
	}
	return true
}

func stateClass(token string) bool {
	token = asciiLower(token)
	for _, word := range stateWords {
		if strings.Contains(token, word) {
			return true
		}
	}
	return false
}

func asciiLower(s string) string {
	return strings.Map(func(c rune) rune {
		if c >= 'A' && c <= 'Z' {
			return c + ('a' - 'A')
		}
		return c
	}, s)
}

var htmlEscaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;")

func escapeHTML(s string) string { return htmlEscaper.Replace(s) }

// utf16Len is the length of s in UTF-16 code units, as JavaScript counts it.
func utf16Len(s string) int {
	n := 0
	for _, c := range s {
		n += utf16.RuneLen(c)
	}
	return n
}

func capText(text string, max int) string {
	if utf16Len(text) > max {
		runes := []rune(text)
		return string(runes[:min(max, len(runes))]) + "..."
	}
	return text
}

func same(a, b *viewItem) bool {
	if a.open != b.open || a.hasClose != b.hasClose || a.close != b.close || len(a.children) != len(b.children) {
		return false
	}
	for i := range a.children {
		if !same(&a.children[i], &b.children[i]) {
			return false
		}
	}
	return true
}

// collapseRuns gives consecutive identical siblings as one item marked `×N`:
// a Masked list is one line.
func collapseRuns(items []viewItem) []viewItem {
	var out []viewItem
	var counts []int
	for i := range items {
		if last := len(out) - 1; last >= 0 && same(&out[last], &items[i]) {
			counts[last]++
			continue
		}
		out = append(out, items[i])
		counts = append(counts, 1)
	}
	for i := range out {
		if counts[i] > 1 {
			out[i].open = fmt.Sprintf("%s ×%d", out[i].open, counts[i])
		}
	}
	return out
}

// renderItems renders items down to maxDepth levels, with the children cap.
func renderItems(items []viewItem, maxDepth int) []string {
	var out []string
	var walk func(list []viewItem, depth int)
	walk = func(list []viewItem, depth int) {
		indent := strings.Repeat("  ", depth)
		shown := list[:min(len(list), maxChildren)]
		for i := range shown {
			item := &shown[i]
			if len(out) > countCap {
				return
			}
			out = append(out, indent+item.open)
			if len(item.children) > 0 {
				if depth+1 >= maxDepth {
					below := 0
					for _, child := range item.children {
						below += child.total
					}
					out = append(out, fmt.Sprintf("%s  ... %d more lines", indent, below))
				} else {
					walk(item.children, depth+1)
				}
			}
			if item.hasClose {
				out = append(out, indent+item.close)
			}
		}
		if len(list) > len(shown) {
			out = append(out, fmt.Sprintf("%s... %d more siblings", indent, len(list)-len(shown)))
		}
	}
	walk(items, 0)
	return out
}

func depthOf(items []viewItem) int {
	deepest := 0
	for i := range items {
		deepest = max(deepest, 1+depthOf(items[i].children))
	}
	return deepest
}

func charsOf(lines []string) int {
	n := 0
	for _, l := range lines {
		n += utf16Len(l) + 1
	}
	return n
}

// fit gives the deepest rendering that fits the budget: whole lines, the
// children cap, and subtrees below the depth as one marker line each. When
// even one level does not fit, it is cut to the budget with a final marker.
func fit(items []viewItem, b budget) ([]string, int) {
	total := 0
	for _, item := range items {
		total += item.total
	}
	total = min(total, countCap)
	fits := func(lines []string) bool { return len(lines) <= b.lines && charsOf(lines) <= b.chars }
	var best []string
	found := false
	for depth := 1; depth <= depthOf(items); depth++ {
		lines := renderItems(items, depth)
		if !fits(lines) {
			break
		}
		best, found = lines, true
	}
	if found {
		return best, total
	}
	// Room for the marker line: one line and its characters.
	lines := renderItems(items, 1)
	var kept []string
	chars := 0
	for _, l := range lines {
		length := utf16Len(l)
		if len(kept)+2 > b.lines || chars+length+1+32 > b.chars {
			break
		}
		kept = append(kept, l)
		chars += length + 1
	}
	return append(kept, fmt.Sprintf("... %d more lines", len(lines)-len(kept))), total
}
