//! Guards cross-package drift between the discovery instructions shipped
//! with the CLI (`everr_core::assistant`) and the Manual-integration snippet
//! in the docs site (`packages/docs/content/docs/cli/telemetry.mdx`).

use std::fs;
use std::path::PathBuf;

use everr_core::assistant::render_discovery_instructions;

const SNIPPET_START: &str = "<!-- AI_INTEGRATION_SNIPPET_START -->";
const SNIPPET_END: &str = "<!-- AI_INTEGRATION_SNIPPET_END -->";

#[test]
fn docs_manual_snippet_matches_discovery_telemetry_line() {
    let telemetry_line = render_discovery_instructions()
        .lines()
        .find(|line| line.contains("everr telemetry ai-instructions"))
        .expect("discovery instructions should contain the telemetry pointer line");

    let docs_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/docs/content/docs/cli/telemetry.mdx");
    let docs = fs::read_to_string(&docs_path)
        .unwrap_or_else(|e| panic!("reading {}: {e}", docs_path.display()));

    let start = docs
        .find(SNIPPET_START)
        .expect("docs page should contain AI_INTEGRATION_SNIPPET_START marker");
    let end = docs
        .find(SNIPPET_END)
        .expect("docs page should contain AI_INTEGRATION_SNIPPET_END marker");
    assert!(start < end, "snippet markers out of order");

    let snippet = &docs[start + SNIPPET_START.len()..end];
    assert!(
        snippet.contains(telemetry_line.trim()),
        "\nDocs manual snippet missing the current telemetry discovery line.\n\
         Expected substring:\n  {}\n\n\
         Snippet block was:\n{}\n",
        telemetry_line.trim(),
        snippet
    );
}
