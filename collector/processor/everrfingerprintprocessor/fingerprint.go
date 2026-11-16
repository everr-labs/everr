package everrfingerprintprocessor

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/go-faster/city"
)

// The fingerprint must equal what the errorFingerprint ClickHouse UDF returns
// for the same row: Errors stored before this processor ran are still grouped
// by the UDF, and both sides have to agree for one Error to stay one group.
// testdata/fingerprints.json pins the values; the chdbexporter tests check the
// UDF against the same file.

var (
	uuidPattern   = regexp.MustCompile(`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`)
	idPattern     = regexp.MustCompile(`\b[0-9]{6,}\b|0x[0-9a-fA-F]+`)
	quotedPattern = regexp.MustCompile(`'[^']{16,}'|"[^"]{16,}"`)
)

// ClickHouse's substring counts bytes, not characters.
const maxMessageBytes = 300

func normalizeMessage(message string) string {
	m := strings.Trim(message, " ")
	m = uuidPattern.ReplaceAllLiteralString(m, "<uuid>")
	m = idPattern.ReplaceAllLiteralString(m, "<id>")
	m = quotedPattern.ReplaceAllLiteralString(m, "<quoted>")
	if len(m) > maxMessageBytes {
		m = m[:maxMessageBytes]
	}
	return m
}

func errorFingerprint(serviceName, fingerprint, exceptionType, exceptionMessage string) string {
	if fingerprint != "" {
		return fingerprint
	}
	h := city.CH64([]byte(serviceName))
	for _, part := range []string{exceptionType, normalizeMessage(exceptionMessage), ""} {
		h = combineHashes(h, city.CH64([]byte(part)))
	}
	return strconv.FormatUint(h, 10)
}

// combineHashes is how a multi-argument cityHash64 folds each argument's hash
// into the running one: CityHash v1.0.2 Hash128to64 over (running, next).
func combineHashes(low, high uint64) uint64 {
	const kMul = 0x9ddfea08eb382d69
	a := (low ^ high) * kMul
	a ^= a >> 47
	b := (high ^ a) * kMul
	b ^= b >> 47
	return b * kMul
}
