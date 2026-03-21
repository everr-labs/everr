#!/usr/bin/env bash
# Regenerates TASKS.md from the current state of .specs/

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
SPECS_DIR="$REPO_ROOT/.specs"
OUTPUT="$REPO_ROOT/TASKS.md"

# Extract the first non-empty line after "## What" in a markdown file
get_what() {
  local file="$1"
  awk '/^## What/{found=1; next} found && /^##/{exit} found && NF{print; exit}' "$file" 2>/dev/null || true
}

build_section() {
  local label="$1"
  local lines="$2"
  if [ -n "$lines" ]; then
    printf "## %s\n\n%s\n\n" "$label" "$lines"
  fi
}

projects_lines=""
ideas_lines=""
issues_lines=""

# Projects: each subdirectory of .specs/projects/
if [ -d "$SPECS_DIR/projects" ]; then
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    problem_file="$SPECS_DIR/projects/$name/shaping/problem.md"
    desc=""
    if [ -f "$problem_file" ]; then
      desc=$(get_what "$problem_file")
    fi
    [ -z "$desc" ] && desc="In shaping"
    projects_lines="${projects_lines}- [**${name}**](.specs/projects/${name}/shaping/problem.md) — ${desc}"$'\n'
  done < <(ls -1 "$SPECS_DIR/projects" 2>/dev/null | sort)
fi

# Ideas: each .md file in .specs/ideas/
if [ -d "$SPECS_DIR/ideas" ]; then
  while IFS= read -r filename; do
    [ -n "$filename" ] || continue
    name="${filename%.md}"
    desc=$(get_what "$SPECS_DIR/ideas/$filename")
    [ -z "$desc" ] && desc="—"
    ideas_lines="${ideas_lines}- [**${name}**](.specs/ideas/${filename}) — ${desc}"$'\n'
  done < <(ls -1 "$SPECS_DIR/ideas" 2>/dev/null | grep '\.md$' | sort)
fi

# Issues: each .md file in .specs/issues/
if [ -d "$SPECS_DIR/issues" ]; then
  while IFS= read -r filename; do
    [ -n "$filename" ] || continue
    name="${filename%.md}"
    desc=$(get_what "$SPECS_DIR/issues/$filename")
    [ -z "$desc" ] && desc="—"
    issues_lines="${issues_lines}- [**${name}**](.specs/issues/${filename}) — ${desc}"$'\n'
  done < <(ls -1 "$SPECS_DIR/issues" 2>/dev/null | grep '\.md$' | sort)
fi

# Write TASKS.md (omit empty sections)
{
  echo "# Tasks"
  echo ""
  build_section "Issues" "${issues_lines%$'\n'}"
  build_section "Projects" "${projects_lines%$'\n'}"
  build_section "Ideas" "${ideas_lines%$'\n'}"
} > "$OUTPUT"

echo "TASKS.md updated."
