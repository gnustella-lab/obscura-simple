#!/usr/bin/env bash
set -euo pipefail

# Fedora-only real build. Run inside Fedora 44; this never invokes dpkg and
# deliberately uses a target directory separate from the Debian build.
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"
OUT="${OUT:-$REPO_ROOT/rpm-out}"
BUILD_ROOT="${RPM_BUILD_ROOT_DIR:-$REPO_ROOT/rpm-build}"
TARGET_DIR="${CARGO_TARGET_DIR:-$REPO_ROOT/fedora-target}"
VERSION="$(python3 -c 'import json; print(json.load(open("tag.json"))["version"])')"
RELEASE="${RPM_RELEASE:-17}"
export OBSCURA_VERSION="v${VERSION}-${RELEASE}"
export OBSCURA_GRESOURCES_DIR="$BUILD_ROOT/resources"

for tool in cargo rpmbuild glib-compile-resources; do command -v "$tool" >/dev/null; done
mkdir -p "$BUILD_ROOT/resources" "$OUT" "$TARGET_DIR"
glib-compile-resources --sourcedir="$REPO_ROOT/rustlib/src/gui" \
  --target="$OBSCURA_GRESOURCES_DIR/icons.gresource" \
  "$REPO_ROOT/rustlib/src/gui/icons.gresource.xml"
python3 "$REPO_ROOT/rustlib/gen-gresource-xml.py" "$REPO_ROOT/simple-ui" "$BUILD_ROOT/webui.xml"
glib-compile-resources --target="$OBSCURA_GRESOURCES_DIR/webui.gresource" "$BUILD_ROOT/webui.xml"

: "${CARGO_BUILD_JOBS:=1}"
: "${CARGO_PROFILE_RELEASE_LTO:=false}"
: "${CARGO_PROFILE_RELEASE_OPT_LEVEL:=0}"
: "${CARGO_PROFILE_RELEASE_DEBUG:=0}"
: "${CARGO_PROFILE_RELEASE_CODEGEN_UNITS:=256}"
export CARGO_BUILD_JOBS CARGO_PROFILE_RELEASE_LTO CARGO_PROFILE_RELEASE_OPT_LEVEL
export CARGO_PROFILE_RELEASE_DEBUG CARGO_PROFILE_RELEASE_CODEGEN_UNITS CARGO_TARGET_DIR="$TARGET_DIR"
printf 'Fedora RPM Cargo profile: jobs=%s lto=%s opt-level=%s debug=%s codegen-units=%s target=%s\n' \
  "$CARGO_BUILD_JOBS" "$CARGO_PROFILE_RELEASE_LTO" "$CARGO_PROFILE_RELEASE_OPT_LEVEL" \
  "$CARGO_PROFILE_RELEASE_DEBUG" "$CARGO_PROFILE_RELEASE_CODEGEN_UNITS" "$CARGO_TARGET_DIR"
cargo build --manifest-path rustlib/Cargo.toml --release --locked \
  --features simple-client,gui --bin obscura --bin obscura-gui

for bin in obscura obscura-gui; do
  path="$TARGET_DIR/release/$bin"
  test -x "$path"
  "$path" --version | grep -F "${VERSION}-${RELEASE}" >/dev/null
  grep -aF '/run/obscura-simple.sock' "$path" >/dev/null
done

SRC="$BUILD_ROOT/SOURCES"
SPEC="$BUILD_ROOT/SPECS/obscura-simple.spec"
rm -rf "$SRC" "$BUILD_ROOT/SPECS" "$BUILD_ROOT/BUILD" "$BUILD_ROOT/BUILDROOT" "$BUILD_ROOT/RPMS" "$BUILD_ROOT/SRPMS"
mkdir -p "$SRC" "$BUILD_ROOT/SPECS"
install -pm0755 "$TARGET_DIR/release/obscura" "$SRC/obscura-simple"
install -pm0755 "$TARGET_DIR/release/obscura-gui" "$SRC/obscura-simple-gui"
sed 's/^Description=Obscura VPN$/Description=Obscura Simple (Unofficial)/; s#^ExecStart=/usr/bin/obscura service$#ExecStart=/usr/bin/obscura-simple service#; s/^Group=obscura$/Group=obscura-simple/; s/^StateDirectory=obscura$/StateDirectory=obscura-simple/; s/^RuntimeDirectory=obscura$/RuntimeDirectory=obscura-simple/; s/^LogsDirectory=obscura$/LogsDirectory=obscura-simple/' \
  linux/common/obscura.service > "$SRC/obscura-simple.service"
printf 'g obscura-simple - -\n' > "$SRC/obscura-simple.sysusers"
printf 'disable obscura-simple.service\n' > "$SRC/obscura-simple.preset"
sed 's/Exec=obscura-gui %u/Exec=obscura-simple-gui %u/; s/Icon=net.obscura.vpn.gui/Icon=io.github.gnustella_lab.obscura_simple/; s/StartupWMClass=net.obscura.vpn.gui/StartupWMClass=io.github.gnustella_lab.obscura_simple/' \
  linux/common/net.obscura.vpn.gui.desktop > "$SRC/obscura-simple.desktop"
python3 - "$SRC/obscura-simple.metainfo.xml" <<'PY'
import sys
import xml.etree.ElementTree as ET
root = ET.parse('linux/common/net.obscura.vpn.gui.metainfo.xml').getroot()
for tag, value in [('id', 'io.github.gnustella_lab.obscura_simple'), ('pkgname', 'obscura-simple'), ('name', 'Obscura Simple (Unofficial)'), ('summary', 'Unofficial community client for Obscura VPN')]:
    node = root.find(tag)
    if node is not None:
        node.text = value
launchable = root.find('launchable')
if launchable is not None:
    launchable.text = 'io.github.gnustella_lab.obscura_simple.desktop'
url = root.find("url[@type='homepage']")
if url is not None:
    url.text = 'https://github.com/gnustella-lab/obscura-simple'
dev = root.find('developer')
if dev is not None:
    dev.set('id', 'io.github.gnustella_lab')
    name = dev.find('name')
    if name is not None:
        name.text = 'Obscura Simple contributors'
description = root.find('description')
if description is not None:
    description.clear()
    ET.SubElement(description, 'p').text = 'Independent community client, not the official Obscura application. Only one VPN backend can run at a time.'
screenshots = root.find('screenshots')
if screenshots is not None:
    root.remove(screenshots)
ET.ElementTree(root).write(sys.argv[1], encoding='unicode', xml_declaration=True)
PY
install -pm0644 LICENSE.md "$SRC/LICENSE.md"
for size in 64 128 256; do
  install -pm0644 "linux/common/icons/${size}x${size}/net.obscura.vpn.gui.png" "$SRC/obscura-simple-${size}.png"
done
cp linux/rpm/obscura-simple.spec "$SPEC"
rpmbuild -bb --define "_topdir $BUILD_ROOT" --define "version $VERSION" --define "release $RELEASE" "$SPEC"
RPM="$(find "$BUILD_ROOT/RPMS" -type f -name 'obscura-simple-*.rpm' ! -name '*debuginfo*' | head -n1)"
test -n "$RPM"
cp -f "$RPM" "$OUT/"
rpm -qip "$OUT/$(basename "$RPM")" >/dev/null
printf 'Built %s\n' "$OUT/$(basename "$RPM")"
