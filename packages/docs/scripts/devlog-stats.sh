#!/bin/bash
# Generate weekly stats for a devlog post.
# Usage: ./scripts/devlog-stats.sh [days]
# Default: 7 days

days="${1:-7}"
since=$(date -v-"${days}"d +%Y-%m-%d)
until=$(date +%Y-%m-%d)

commits=$(git log --since="$since" --until="$until" --all --oneline --no-merges | wc -l | tr -d ' ')
prs=$(git log --since="$since" --until="$until" --all --oneline --merges --format="%s" | grep -c "Merge pull request")
read -r additions deletions <<< $(git log --since="$since" --until="$until" --all --no-merges --shortstat --format="" | awk '{i+=$4; d+=$6} END {print i, d}')

echo "commits: ${commits}"
echo "prs: ${prs}"
echo "additions: ${additions:-0}"
echo "deletions: ${deletions:-0}"
