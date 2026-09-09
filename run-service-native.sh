#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN="$SCRIPT_DIR/rustlib/target/debug/obscura"
case "$("$BIN" --version)" in
  'obscura-simple '*) ;;
  *) printf 'Build the CLI with --features simple-client before using this helper.\n' >&2; exit 1 ;;
esac
getent group obscura-simple >/dev/null || {
  printf 'Install the Simple package to create its operator group first.\n' >&2
  exit 1
}
# Never delete sockets or stop the official service. The backend's shared lock
# rejects concurrent use before any firewall, tunnel or DNS initialization.
exec sudo --preserve-env=RUST_LOG -u root -g obscura-simple bash -c \
  'umask 0007; exec "$1" service --config-dir /var/lib/obscura-simple --log-dir /var/log/obscura-simple' \
  obscura-simple-service "$BIN"
