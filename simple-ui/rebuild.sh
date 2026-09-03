#!/usr/bin/env bash
set -eux
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p /tmp/obscura-gresources
glib-compile-resources --sourcedir="$SCRIPT_DIR/rustlib/src/gui" --target=/tmp/obscura-gresources/icons.gresource "$SCRIPT_DIR/rustlib/src/gui/icons.gresource.xml"
python3 "$SCRIPT_DIR/rustlib/gen-gresource-xml.py" "$SCRIPT_DIR/simple-ui" /tmp/webui.generated.xml
glib-compile-resources --target=/tmp/obscura-gresources/webui.gresource /tmp/webui.generated.xml
OBSCURA_VERSION="v1.177" OBSCURA_GRESOURCES_DIR=/tmp/obscura-gresources cargo build --manifest-path "$SCRIPT_DIR/rustlib/Cargo.toml" --features gui --bin obscura-gui
echo "GUI rebuild done: $SCRIPT_DIR/rustlib/target/debug/obscura-gui"
ls -lh /tmp/obscura-gresources/
