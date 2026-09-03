#!/usr/bin/env bash
set -eux
# Wrapper for contrib/bin/build-simple-deb.bash
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec "$SCRIPT_DIR/contrib/bin/build-simple-deb.bash" "$@"
