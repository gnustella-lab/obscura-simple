#!/usr/bin/env bash
set -euo pipefail
# Package the source-built native release GUI against the GNOME runtime.
# The privileged host service remains in the matching .deb, never in Flatpak.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP_ID=io.github.gnustella_lab.obscura_simple
RUNTIME=org.gnome.Platform
RUNTIME_BRANCH=50
DEB="${1:-$ROOT/obscura-simple_1.177-16_amd64.deb}"
OUT="${2:-$ROOT/obscura-simple_1.177-16_x86_64.flatpak}"
[ "$(dpkg-deb -f "$DEB" Package)" = obscura-simple ]
[ "$(dpkg-deb -f "$DEB" Architecture)" = amd64 ]
VERSION="$(dpkg-deb -f "$DEB" Version)"
[ "$VERSION" = 1.177-16 ]
[ "$(flatpak --default-arch)" = x86_64 ]
flatpak info "$RUNTIME//$RUNTIME_BRANCH" >/dev/null
WORK="$(mktemp -d -t obscura-simple-flatpak.XXXXXXXX)"
trap 'rm -rf "$WORK"' EXIT
BUILD="$WORK/build"
# No compiler SDK is needed here: the ELF was compiled by build-simple-deb.bash.
# Using the Platform as the build environment also checks runtime ABI compatibility.
flatpak build-init "$BUILD" "$APP_ID" "$RUNTIME" "$RUNTIME" "$RUNTIME_BRANCH"
dpkg-deb -x "$DEB" "$WORK/deb"
install -Dm755 "$WORK/deb/usr/bin/obscura-simple-gui" "$BUILD/files/bin/obscura-simple-gui"
for size in 64 128 256; do
  install -Dm644 "$WORK/deb/usr/share/icons/hicolor/${size}x${size}/apps/$APP_ID.png" "$BUILD/files/share/icons/hicolor/${size}x${size}/apps/$APP_ID.png"
done
install -Dm644 "$WORK/deb/usr/share/applications/$APP_ID.desktop" "$BUILD/files/share/applications/$APP_ID.desktop"
install -Dm644 "$WORK/deb/usr/share/metainfo/$APP_ID.metainfo.xml" "$BUILD/files/share/metainfo/$APP_ID.metainfo.xml"
install -Dm644 "$ROOT/LICENSE.md" "$BUILD/files/share/licenses/$APP_ID/LICENSE.md"
python3 - "$BUILD" "$VERSION" <<'PY'
import datetime
import pathlib
import sys
import xml.etree.ElementTree as ET
build = pathlib.Path(sys.argv[1])
app_id = 'io.github.gnustella_lab.obscura_simple'
p = build / f'files/share/metainfo/{app_id}.metainfo.xml'
root = ET.parse(p).getroot()
pkg = root.find('pkgname')
if pkg is not None:
    root.remove(pkg)
description = root.find('description')
assert description is not None
ET.SubElement(description, 'p').text = 'Flatpak interface only. Requires the matching obscura-simple host service package. Service installation, operator permissions and desktop autostart must be configured on the host.'
releases = ET.SubElement(root, 'releases')
ET.SubElement(releases, 'release', version=sys.argv[2], date=datetime.datetime.now(datetime.timezone.utc).date().isoformat())
p.write_text(ET.tostring(root, encoding='unicode'))
PY
flatpak build "$BUILD" /app/bin/obscura-simple-gui --version
flatpak build-finish "$BUILD" \
  --command=obscura-simple-gui \
  --socket=wayland --socket=fallback-x11 --share=ipc --share=network --device=dri \
  --filesystem=/run/obscura-simple.sock:ro \
  --filesystem=/run/obscura-simple-live-groups.sock:ro \
  --system-talk-name=org.freedesktop.systemd1 \
  --talk-name=org.kde.StatusNotifierWatcher
flatpak build-export --arch=x86_64 "$WORK/repo" "$BUILD" stable
flatpak build-bundle --arch=x86_64 \
  --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo \
  "$WORK/repo" "$OUT" "$APP_ID" stable
printf 'Built %s\nRequires host service: obscura-simple %s\n' "$OUT" "$VERSION"
