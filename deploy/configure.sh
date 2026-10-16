#!/bin/sh
set -eu

cd "$(dirname "$0")"
if [ -e .env ]; then
  echo '.env already exists; edit it to keep your existing secrets.' >&2
  exit 1
fi

command -v openssl >/dev/null
umask 077
set -C
while IFS= read -r line || [ -n "$line" ]; do
  if [ "${line#*=}" = replace-with-a-strong-random-value ]; then
    value=$(openssl rand -hex 32)
    line="${line%%=*}=$value"
  fi
  printf '%s\n' "$line"
done < .env.example > .env

echo 'Created .env. Run docker compose up -d --build --wait.'
