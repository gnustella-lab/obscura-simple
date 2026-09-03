#!/usr/bin/env bash
set -eux
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# If the current shell does not have the obscura group effective (common after usermod), re-exec via sg which reloads getgrouplist.
# This is required because the main socket requires effective group, and the live-groups fallback requires getgrouplist.
if ! id -nG | grep -qw obscura; then
  if groups "$USER" | grep -qw obscura; then
    echo "Obscura group not effective in this shell (run 'newgrp obscura' or logout). Trying via sg obscura..." >&2
    cmd=$(printf '%q ' "$SCRIPT_DIR/rustlib/target/debug/obscura" "$@")
    exec sg obscura -c "$cmd"
  fi
fi
# Helpful diagnostic if service is not running (checks pgrep, not just stale socket)
if ! pgrep -f "obscura service" > /dev/null; then
  echo "Warning: service is not running (pgrep obscura service empty)." >&2
  if [ -S /run/obscura.sock ] || [ -S /run/obscura-live-groups.sock ]; then
    echo "Stale sockets found: $(ls -l /run/obscura*.sock 2>&1)" >&2
    echo "Clean with: sudo rm -f /run/obscura.sock /run/obscura-live-groups.sock" >&2
  fi
  echo "Run in ANOTHER terminal and keep it running: ./run-service-native.sh" >&2
fi
exec "$SCRIPT_DIR/rustlib/target/debug/obscura" "$@"
