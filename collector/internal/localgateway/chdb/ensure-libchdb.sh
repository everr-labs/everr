#!/usr/bin/env bash
set -euo pipefail

version="$1"
asset_name="$2"
expected_sha="$3"
cache_dir="$4"
extract_dir="$5"

archive_path="$cache_dir/${version}-${asset_name}"
tmp_path="${archive_path}.tmp"
url="https://github.com/chdb-io/chdb/releases/download/${version}/${asset_name}"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
    return
  fi

  shasum -a 256 "$1" | awk '{print $1}'
}

mkdir -p "$cache_dir"

if [[ -f "$archive_path" ]]; then
  digest="$(sha256_file "$archive_path")"
  if [[ "$digest" != "$expected_sha" ]]; then
    echo "Ignoring cached $archive_path because sha256 is $digest; expected $expected_sha." >&2
    rm -f "$archive_path"
  fi
fi

if [[ ! -f "$archive_path" ]]; then
  rm -f "$tmp_path"
  curl --fail --location --silent --show-error --output "$tmp_path" "$url"
  digest="$(sha256_file "$tmp_path")"
  if [[ "$digest" != "$expected_sha" ]]; then
    rm -f "$tmp_path"
    echo "Downloaded $asset_name has sha256 $digest; expected $expected_sha." >&2
    exit 1
  fi
  mv "$tmp_path" "$archive_path"
fi

rm -rf "$extract_dir"
mkdir -p "$extract_dir"
tar -xzf "$archive_path" -C "$extract_dir"

lib_path="$(find "$extract_dir" -type f -name 'libchdb.so' -print -quit)"
if [[ -z "$lib_path" ]]; then
  echo "$asset_name did not contain libchdb.so." >&2
  exit 1
fi

if [[ "$lib_path" != "$extract_dir/libchdb.so" ]]; then
  cp "$lib_path" "$extract_dir/libchdb.so"
fi

chmod 0644 "$extract_dir/libchdb.so"
