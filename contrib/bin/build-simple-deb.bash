#!/usr/bin/env bash
set -euo pipefail
# Build the isolated, unofficial Linux client. Never installs or starts it.
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"
OUT=""
ARCH="$(dpkg --print-architecture)"
NO_BUILD=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    --no-build) NO_BUILD=1; shift ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 1 ;;
  esac
done
case "$ARCH" in amd64|arm64) ;; *) printf 'Unsupported architecture\n' >&2; exit 1 ;; esac
[ "$ARCH" = "$(dpkg --print-architecture)" ] || { printf 'Cross compilation is not supported by this builder\n' >&2; exit 1; }
VERSION="$(python3 -c 'import json; print(json.load(open("tag.json"))["version"])')"
DEB_VERSION="${VERSION}-17"
OUT="${OUT:-$REPO_ROOT/obscura-simple_${DEB_VERSION}_${ARCH}.deb}"
WORK="$(mktemp -d -t obscura-simple-build.XXXXXXXX)"
trap 'rm -rf "$WORK"' EXIT
export OBSCURA_GRESOURCES_DIR="$WORK/resources"
export OBSCURA_VERSION="v$DEB_VERSION"
mkdir -p "$OBSCURA_GRESOURCES_DIR"
glib-compile-resources --sourcedir="$REPO_ROOT/rustlib/src/gui" --target="$OBSCURA_GRESOURCES_DIR/icons.gresource" rustlib/src/gui/icons.gresource.xml
python3 rustlib/gen-gresource-xml.py "$REPO_ROOT/simple-ui" "$WORK/webui.xml"
glib-compile-resources --target="$OBSCURA_GRESOURCES_DIR/webui.gresource" "$WORK/webui.xml"
if [ -z "$NO_BUILD" ]; then
  # Keep the low-memory knobs in the environment so the repository's production
  # profile is unchanged. The explicit print makes the values auditable in CI.
  : "${CARGO_BUILD_JOBS:=1}"
  : "${CARGO_PROFILE_RELEASE_LTO:=false}"
  : "${CARGO_PROFILE_RELEASE_OPT_LEVEL:=0}"
  : "${CARGO_PROFILE_RELEASE_DEBUG:=0}"
  : "${CARGO_PROFILE_RELEASE_CODEGEN_UNITS:=256}"
  export CARGO_BUILD_JOBS CARGO_PROFILE_RELEASE_LTO CARGO_PROFILE_RELEASE_OPT_LEVEL
  export CARGO_PROFILE_RELEASE_DEBUG CARGO_PROFILE_RELEASE_CODEGEN_UNITS
  printf 'Cargo environment: CARGO_BUILD_JOBS=%s CARGO_PROFILE_RELEASE_LTO=%s CARGO_PROFILE_RELEASE_OPT_LEVEL=%s CARGO_PROFILE_RELEASE_DEBUG=%s CARGO_PROFILE_RELEASE_CODEGEN_UNITS=%s\n' \
    "$CARGO_BUILD_JOBS" "$CARGO_PROFILE_RELEASE_LTO" "$CARGO_PROFILE_RELEASE_OPT_LEVEL" \
    "$CARGO_PROFILE_RELEASE_DEBUG" "$CARGO_PROFILE_RELEASE_CODEGEN_UNITS"
  env CARGO_BUILD_JOBS="$CARGO_BUILD_JOBS" \
    CARGO_PROFILE_RELEASE_LTO="$CARGO_PROFILE_RELEASE_LTO" \
    CARGO_PROFILE_RELEASE_OPT_LEVEL="$CARGO_PROFILE_RELEASE_OPT_LEVEL" \
    CARGO_PROFILE_RELEASE_DEBUG="$CARGO_PROFILE_RELEASE_DEBUG" \
    CARGO_PROFILE_RELEASE_CODEGEN_UNITS="$CARGO_PROFILE_RELEASE_CODEGEN_UNITS" \
    cargo build --manifest-path rustlib/Cargo.toml --release --locked \
      --features simple-client,gui --bin obscura --bin obscura-gui
fi
TARGET="${CARGO_TARGET_DIR:-$REPO_ROOT/rustlib/target}/release"
# Refuse old or upstream binaries even with --no-build.
for bin in obscura obscura-gui; do
  [ -x "$TARGET/$bin" ] || { printf 'Missing binary: %s\n' "$TARGET/$bin" >&2; exit 1; }
  "$TARGET/$bin" --version | python3 -c 'import sys; assert sys.argv[1] in sys.stdin.read(), "binary version mismatch"' "$DEB_VERSION"
  python3 -c 'import pathlib,sys; assert b"/run/obscura-simple.sock" in pathlib.Path(sys.argv[1]).read_bytes(), "binary lacks Simple IPC identity"' "$TARGET/$bin"
done
STAGING="$WORK/staging"
export STAGING
mkdir -p "$STAGING/DEBIAN"
install -Dm755 "$TARGET/obscura" "$STAGING/usr/bin/obscura-simple"
install -Dm755 "$TARGET/obscura-gui" "$STAGING/usr/bin/obscura-simple-gui"
# Derive fork resources from upstream templates without modifying upstream packages.
python3 - <<'PY'
import os
from pathlib import Path
root = Path(os.environ['STAGING'])
app_id = 'io.github.gnustella_lab.obscura_simple'
def put(path, text):
    p = root / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)
unit = Path('linux/common/obscura.service').read_text().replace('obscura', 'obscura-simple').replace('Description=Obscura VPN', 'Description=Obscura Simple (Unofficial)')
put('usr/lib/systemd/system/obscura-simple.service', unit)
put('usr/lib/sysusers.d/obscura-simple.conf', 'g obscura-simple - -\n')
put('usr/lib/systemd/system-preset/80-obscura-simple.preset', 'disable obscura-simple.service\n')
desktop = Path('rustlib/src/linux/autostart-simple.desktop').read_text().replace(' --xdg-autostart', ' %u')
# Do not claim the official obscuravpn URL scheme.
put(f'usr/share/applications/{app_id}.desktop', desktop)
import xml.etree.ElementTree as ET
meta = ET.parse('linux/common/net.obscura.vpn.gui.metainfo.xml').getroot()
for tag, value in {
    'id': app_id,
    'pkgname': 'obscura-simple',
    'name': 'Obscura Simple (Unofficial)',
    'summary': 'Unofficial community client for Obscura VPN',
    'launchable': f'{app_id}.desktop',
    'url': 'https://github.com/gnustella-lab/obscura-simple',
    'developer/name': 'Obscura Simple contributors',
}.items():
    node = meta.find(tag)
    assert node is not None, tag
    node.text = value
meta.find('developer').set('id', 'io.github.gnustella_lab')
description = meta.find('description')
description.clear()
ET.SubElement(description, 'p').text = 'Independent community client, not the official Obscura application. Requires an Obscura VPN account. Only one VPN backend can run at a time.'
# Official Alpha screenshots do not document the community UI.
screenshots = meta.find('screenshots')
if screenshots is not None:
    meta.remove(screenshots)
put(f'usr/share/metainfo/{app_id}.metainfo.xml', ET.tostring(meta, encoding='unicode'))
profile = Path('linux/deb/apparmor/obscura-gui').read_text().replace('obscura-gui', 'obscura-simple-gui')
put('etc/apparmor.d/obscura-simple-gui', profile)
PY
for size in 64 128 256; do
  install -Dm644 "linux/common/icons/${size}x${size}/net.obscura.vpn.gui.png" "$STAGING/usr/share/icons/hicolor/${size}x${size}/apps/io.github.gnustella_lab.obscura_simple.png"
done
install -Dm644 LICENSE.md "$STAGING/usr/share/doc/obscura-simple/copyright"
cat > "$STAGING/DEBIAN/control" <<EOF
Package: obscura-simple
Version: ${DEB_VERSION}
Section: net
Priority: optional
Architecture: ${ARCH}
Maintainer: Obscura Simple contributors <noreply@github.com>
Homepage: https://github.com/gnustella-lab/obscura-simple
Depends: libc6 (>= 2.39), passwd, util-linux-extra, policykit-1, libtss2-esys-3.0.2-0t64, libtss2-mu-4.0.1-0t64, libtss2-sys1t64, libtss2-tctildr0t64, libtss2-tcti-device0t64, desktop-file-utils, libgtk-4-1, libadwaita-1-0, libwebkitgtk-6.0-4, libsoup-3.0-0
Description: Unofficial community client for Obscura VPN
 Separate CLI, GUI, permissions and service state from the official client.
 The service is not automatically enabled or started during installation.
Installed-Size: $(du -sk "$STAGING" | cut -f1)
EOF
cat > "$STAGING/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = configure ]; then
    if command -v systemd-sysusers >/dev/null 2>&1; then
        systemd-sysusers /usr/lib/sysusers.d/obscura-simple.conf
    elif ! getent group obscura-simple >/dev/null 2>&1; then
        groupadd --system obscura-simple
    fi
    if command -v systemctl >/dev/null 2>&1; then
        systemctl daemon-reload
    fi
    if command -v apparmor_parser >/dev/null 2>&1; then
        apparmor_parser -r /etc/apparmor.d/obscura-simple-gui
    fi
    printf '%s\n' 'Obscura Simple installed without starting or enabling its service.' 'The official client was not modified. Only one VPN backend can run at a time.' 'Grant access with: sudo obscura-simple add-operator USER'
fi
EOF
cat > "$STAGING/DEBIAN/prerm" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = remove ]; then
    if command -v systemctl >/dev/null 2>&1; then
        systemctl stop obscura-simple.service
    fi
fi
EOF
cat > "$STAGING/DEBIAN/postrm" <<'EOF'
#!/bin/sh
set -e
if command -v systemctl >/dev/null 2>&1; then
    if [ "$1" = purge ]; then
        systemctl disable obscura-simple.service || true
    fi
    systemctl daemon-reload || true
fi
# Never remove old shared state or touch obscura.service, even on purge.
EOF
chmod 755 "$STAGING/DEBIAN/postinst" "$STAGING/DEBIAN/prerm" "$STAGING/DEBIAN/postrm"
printf 'interest desktop-database\ninterest hicolor-icon-theme\n' > "$STAGING/DEBIAN/triggers"
dpkg-deb --root-owner-group --build "$STAGING" "$OUT"
printf 'Built %s\n' "$OUT"
printf '%s\n' 'This single package contains the Simple CLI, privileged service and native GTK/WebKit GUI; no Flatpak is required.'
