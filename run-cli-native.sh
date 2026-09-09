#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN="$SCRIPT_DIR/rustlib/target/debug/obscura"
case "$("$BIN" --version)" in
  'obscura-simple '*) ;;
  *) printf 'Build the CLI with --features simple-client before using this helper.\n' >&2; exit 1 ;;
esac
exec "$BIN" "$@"
