#!/usr/bin/env bash
# Regenerates TODO.md from the current state of todo/

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
TODO_DIR="$REPO_ROOT/todo"
OUTPUT="$REPO_ROOT/TODO.md"

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

# Projects: each subdirectory of todo/projects/
if [ -d "$TODO_DIR/projects" ]; then
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    problem_file="$TODO_DIR/projects/$name/shaping/problem.md"
    desc=""
    if [ -f "$problem_file" ]; then
      desc=$(get_what "$problem_file")
    fi
    [ -z "$desc" ] && desc="In shaping"
    projects_lines="${projects_lines}- [**${name}**](todo/projects/${name}/shaping/problem.md) — ${desc}"$'\n'
  done < <(ls -1 "$TODO_DIR/projects" 2>/dev/null | sort)
fi

# Ideas: each .md file in todo/ideas/
if [ -d "$TODO_DIR/ideas" ]; then
  while IFS= read -r filename; do
    [ -n "$filename" ] || continue
    name="${filename%.md}"
    desc=$(get_what "$TODO_DIR/ideas/$filename")
    [ -z "$desc" ] && desc="—"
    ideas_lines="${ideas_lines}- [**${name}**](todo/ideas/${filename}) — ${desc}"$'\n'
  done < <(ls -1 "$TODO_DIR/ideas" 2>/dev/null | grep '\.md$' | sort)
fi

# Issues: each .md file in todo/issues/
if [ -d "$TODO_DIR/issues" ]; then
  while IFS= read -r filename; do
    [ -n "$filename" ] || continue
    name="${filename%.md}"
    desc=$(get_what "$TODO_DIR/issues/$filename")
    [ -z "$desc" ] && desc="—"
    issues_lines="${issues_lines}- [**${name}**](todo/issues/${filename}) — ${desc}"$'\n'
  done < <(ls -1 "$TODO_DIR/issues" 2>/dev/null | grep '\.md$' | sort)
fi

# Write TODO.md (omit empty sections)
{
  echo "# TODO"
  echo ""
  build_section "Issues" "${issues_lines%$'\n'}"
  build_section "Projects" "${projects_lines%$'\n'}"
  build_section "Ideas" "${ideas_lines%$'\n'}"
} > "$OUTPUT"

echo "TODO.md updated."
