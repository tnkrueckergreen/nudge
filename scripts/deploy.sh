#!/usr/bin/env bash

set -euo pipefail
set +x

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRED="$ROOT/.credentials.local"
FILE="$ROOT/dist/index.html"

if [ ! -f "$CRED" ]; then
  echo "No credentials file at $CRED" >&2
  echo "Expected 3 lines: Gemini key, Neocities site name, Neocities password." >&2
  exit 1
fi

if [ ! -f "$FILE" ]; then
  echo "No build at $FILE — run: npm run build" >&2
  exit 1
fi

if [ "$(awk 'END{print NR}' "$CRED")" -lt 3 ]; then
  echo "$CRED has fewer than 3 lines; need site name on line 2 and password on line 3." >&2
  exit 1
fi

echo "Uploading $(wc -c < "$FILE" | tr -d ' ') bytes as $(sed -n 2p "$CRED")/index.html…"

printf 'user = "%s:%s"\n' "$(sed -n 2p "$CRED")" "$(sed -n 3p "$CRED")" \
  | curl --silent --show-error --fail-with-body \
         --config - \
         --form "index.html=@$FILE" \
         "${NEOCITIES_ENDPOINT:-https://neocities.org/api/upload}"

echo
echo "Done. Hard-reload the site — Neocities serves a cached copy otherwise."
