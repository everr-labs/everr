package store

import (
	"errors"
	"slices"
)

// dirKind is what the chDB directory holds, read without opening chDB.
type dirKind int

const (
	// dirEmpty is a directory that is absent, empty, or holds only dotfiles
	// and no marker.
	dirEmpty dirKind = iota
	dirMarked
	// dirChDB holds a chDB layout (a metadata directory) and no marker: a
	// store from before this package, or a reset that crashed.
	dirChDB
	// dirForeign holds files that are not ours.
	dirForeign
)

// marker records what built the store. Applied maps a migration file name to
// the SHA-256 of its text.
type marker struct {
	Version int               `json:"version"`
	Applied map[string]string `json:"applied"`
}

type observed struct {
	kind dirKind
	// marker is valid when kind is dirMarked and markerErr is nil.
	marker    marker
	markerErr error
}

type resetReason string

const (
	noReset          resetReason = ""
	unmarkedStore    resetReason = "store has no marker"
	corruptMarker    resetReason = "marker unreadable"
	versionChanged   resetReason = "store version changed"
	unknownMigration resetReason = "store has a migration this binary lacks"
	changedMigration resetReason = "an applied migration changed"
)

type plan struct {
	reset resetReason
	// freshMarker is true when the directory needs a marker with nothing
	// applied before chDB opens: a new directory, or after a reset.
	freshMarker bool
	// pending is what to apply, in file-name order.
	pending []migration
}

var errForeignDirectory = errors.New("the chDB path holds files that are not a chDB store, so it is not deleted")

// decide maps what the disk holds to what this start does. local is in
// file-name order.
func decide(seen observed, local []migration) (plan, error) {
	switch seen.kind {
	case dirEmpty:
		return plan{freshMarker: true, pending: local}, nil
	case dirForeign:
		return plan{}, errForeignDirectory
	case dirChDB:
		return resetPlan(unmarkedStore, local), nil
	}
	if seen.markerErr != nil {
		return resetPlan(corruptMarker, local), nil
	}
	if seen.marker.Version != Version {
		return resetPlan(versionChanged, local), nil
	}
	known := make(map[string]string, len(local))
	for _, m := range local {
		known[m.name] = m.sum
	}
	for _, name := range sortedKeys(seen.marker.Applied) {
		sum, ok := known[name]
		if !ok {
			return resetPlan(unknownMigration, local), nil
		}
		if sum != seen.marker.Applied[name] {
			return resetPlan(changedMigration, local), nil
		}
	}
	var pending []migration
	for _, m := range local {
		if _, done := seen.marker.Applied[m.name]; !done {
			pending = append(pending, m)
		}
	}
	return plan{pending: pending}, nil
}

func resetPlan(reason resetReason, local []migration) plan {
	return plan{reset: reason, freshMarker: true, pending: local}
}

func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}
