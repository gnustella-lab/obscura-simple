#!/usr/bin/env bash
set -eux
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export OBSCURA_GRESOURCES_DIR="/tmp/obscura-gresources"
WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 exec "$SCRIPT_DIR/rustlib/target/debug/obscura-gui" "$@"
