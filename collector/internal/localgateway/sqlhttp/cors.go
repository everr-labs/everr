package sqlhttp

import "net/http"

// The SQL endpoint answers arbitrary SELECT over everything on the machine and
// has no authentication, because binding to loopback was the entire security
// model. A wildcard Access-Control-Allow-Origin is precisely what removes
// loopback as a boundary: any page in any tab could then read local telemetry.
// So the allowlist is exact-match and deliberately short.
//
// localhost and 127.0.0.1 are distinct origins to a browser, and the dev app is
// reachable at both spellings, so both are listed.
var defaultAllowedOrigins = []string{
	"https://app.everr.dev",
	"http://localhost:5173",
	"http://127.0.0.1:5173",
}

// privateNetworkHeader is required when a public origin (the hosted app) reaches
// a private address (this loopback listener). Chrome sends a preflight carrying
// Access-Control-Request-Private-Network and fails the request unless the
// response allows it.
//
// This header is being renamed as the specification moves from Private Network
// Access to Local Network Access. Emitting the current name is correct today and
// will need revisiting.
const privateNetworkHeader = "Access-Control-Allow-Private-Network"

func isAllowedOrigin(origin string) bool {
	for _, allowed := range defaultAllowedOrigins {
		if origin == allowed {
			return true
		}
	}
	return false
}

// writeCORSHeaders echoes the matched origin, or writes nothing at all when the
// origin is absent or not on the allowlist. Vary is set whenever an Origin was
// present so a shared cache cannot serve one origin's response to another.
//
// Access-Control-Allow-Credentials is deliberately never set: the endpoint has
// no notion of a credential, and enabling it would widen what a matched origin
// can do.
func writeCORSHeaders(w http.ResponseWriter, r *http.Request) (origin string, allowed bool) {
	origin = r.Header.Get("Origin")
	if origin == "" {
		return "", false
	}

	w.Header().Add("Vary", "Origin")
	if !isAllowedOrigin(origin) {
		return origin, false
	}

	w.Header().Set("Access-Control-Allow-Origin", origin)
	return origin, true
}

// handlePreflight answers the CORS preflight. It returns true when the request
// was a preflight and the response is complete.
func handlePreflight(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodOptions {
		return false
	}

	_, allowed := writeCORSHeaders(w, r)
	if allowed {
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Add("Vary", "Access-Control-Request-Headers")
		if r.Header.Get("Access-Control-Request-Private-Network") != "" {
			w.Header().Set(privateNetworkHeader, "true")
		}
	}

	// A disallowed origin gets a bare 204 with no allow headers, which is what
	// makes the browser refuse the real request.
	w.WriteHeader(http.StatusNoContent)
	return true
}
