#!/usr/bin/env bash
set -eux
# Build a ready-to-use single .deb with simple-ui (obscura-simple).
# Usage: ./contrib/bin/build-simple-deb.bash [--out ./obscura-simple_1.177-1_amd64.deb] [--arch amd64] [--no-build]
# Requires: cargo, glib-compile-resources, python3, dpkg-deb (and optionally lintian)

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"
source contrib/shell/source-die.bash || die() { echo "die: $*" >&2; exit 1; }

OUT=""
ARCH=""
NO_BUILD=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    --no-build) NO_BUILD=1; shift ;;
    *) die "unknown arg $1" ;;
  esac
done

if [ -z "$ARCH" ]; then
  ARCH="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
  if [ "$ARCH" = "x86_64" ]; then ARCH=amd64; fi
  if [ "$ARCH" = "aarch64" ]; then ARCH=arm64; fi
fi
case "$ARCH" in amd64|arm64) ;; *) die "unsupported arch $ARCH (use amd64/arm64)" ;; esac

# Version: try nix, else tag.json, else fallback
VERSION=""
if command -v nix >/dev/null 2>&1 && nix build '.#version' --no-link --print-out-paths 2>/dev/null; then
  VERSION="$(cat "$(nix build '.#version' --no-link --print-out-paths)")"
else
  if [ -f tag.json ]; then
    VERSION="v$(python3 -c 'import json; print(json.load(open("tag.json"))["version"])')"
  else
    VERSION="v1.177"
  fi
fi
VERSION="${VERSION#v}"
VERSION="${VERSION%%-*}"
DEB_VERSION="${VERSION}-2"
if [ -z "$OUT" ]; then
  OUT="$REPO_ROOT/obscura-simple_${DEB_VERSION}_${ARCH}.deb"
fi

GRESOURCES_DIR="/tmp/obscura-gresources-simple"
mkdir -p "$GRESOURCES_DIR"

echo "=== Building gresources (simple-ui) -> $GRESOURCES_DIR ==="
glib-compile-resources --sourcedir="$REPO_ROOT/rustlib/src/gui" --target="$GRESOURCES_DIR/icons.gresource" "$REPO_ROOT/rustlib/src/gui/icons.gresource.xml"
python3 "$REPO_ROOT/rustlib/gen-gresource-xml.py" "$REPO_ROOT/simple-ui" /tmp/webui.generated.xml
glib-compile-resources --target="$GRESOURCES_DIR/webui.gresource" /tmp/webui.generated.xml
ls -lh "$GRESOURCES_DIR"

if [ -z "$NO_BUILD" ]; then
  echo "=== Building release binaries (simple-ui) ==="
  OBSCURA_VERSION="v$VERSION" OBSCURA_GRESOURCES_DIR="$GRESOURCES_DIR" cargo build --manifest-path "$REPO_ROOT/rustlib/Cargo.toml" --release --locked --bin obscura
  OBSCURA_VERSION="v$VERSION" OBSCURA_GRESOURCES_DIR="$GRESOURCES_DIR" cargo build --manifest-path "$REPO_ROOT/rustlib/Cargo.toml" --release --features gui --bin obscura-gui
  echo "=== Binaries ==="
  ls -lh "$REPO_ROOT/rustlib/target/release/obscura" "$REPO_ROOT/rustlib/target/release/obscura-gui"
else
  echo "=== Skipping cargo build (--no-build) ==="
fi

for bin in obscura obscura-gui; do
  if [ ! -f "$REPO_ROOT/rustlib/target/release/$bin" ]; then
    die "missing $REPO_ROOT/rustlib/target/release/$bin (run without --no-build)"
  fi
done

STAGING="/tmp/deb-build-obscura-simple/staging"
rm -rf "$STAGING"
mkdir -p "$STAGING/DEBIAN"
mkdir -p "$STAGING/usr/bin"
mkdir -p "$STAGING/usr/lib/systemd/system"
mkdir -p "$STAGING/usr/lib/sysusers.d"
mkdir -p "$STAGING/usr/lib/systemd/system-preset"
mkdir -p "$STAGING/usr/share/applications"
mkdir -p "$STAGING/usr/share/metainfo"
mkdir -p "$STAGING/usr/share/icons/hicolor/64x64/apps"
mkdir -p "$STAGING/usr/share/icons/hicolor/128x128/apps"
mkdir -p "$STAGING/usr/share/icons/hicolor/256x256/apps"
mkdir -p "$STAGING/etc/apparmor.d"

echo "=== Staging files ==="
install -Dm755 "$REPO_ROOT/rustlib/target/release/obscura" "$STAGING/usr/bin/obscura"
install -Dm755 "$REPO_ROOT/rustlib/target/release/obscura-gui" "$STAGING/usr/bin/obscura-gui"
install -Dm644 "$REPO_ROOT/linux/common/obscura.service" "$STAGING/usr/lib/systemd/system/obscura.service"
install -Dm644 "$REPO_ROOT/linux/common/obscura-sysusers.conf" "$STAGING/usr/lib/sysusers.d/obscura.conf"
install -Dm644 "$REPO_ROOT/linux/common/obscura-preset.conf" "$STAGING/usr/lib/systemd/system-preset/80-obscura.preset"
install -Dm644 "$REPO_ROOT/linux/common/net.obscura.vpn.gui.desktop" "$STAGING/usr/share/applications/net.obscura.vpn.gui.desktop"
install -Dm644 "$REPO_ROOT/linux/common/net.obscura.vpn.gui.metainfo.xml" "$STAGING/usr/share/metainfo/net.obscura.vpn.gui.metainfo.xml"
install -Dm644 "$REPO_ROOT/linux/common/icons/64x64/net.obscura.vpn.gui.png" "$STAGING/usr/share/icons/hicolor/64x64/apps/net.obscura.vpn.gui.png"
install -Dm644 "$REPO_ROOT/linux/common/icons/128x128/net.obscura.vpn.gui.png" "$STAGING/usr/share/icons/hicolor/128x128/apps/net.obscura.vpn.gui.png"
install -Dm644 "$REPO_ROOT/linux/common/icons/256x256/net.obscura.vpn.gui.png" "$STAGING/usr/share/icons/hicolor/256x256/apps/net.obscura.vpn.gui.png"
install -Dm644 "$REPO_ROOT/linux/deb/apparmor/obscura-gui" "$STAGING/etc/apparmor.d/obscura-gui"

# share/doc for lintian happiness
mkdir -p "$STAGING/usr/share/doc/obscura-simple"
{ echo "Copyright 2025 Sovereign Engineering Inc. All rights reserved."; echo; cat "$REPO_ROOT/LICENSE.md"; } > "$STAGING/usr/share/doc/obscura-simple/copyright"
# changelog minimal
mkdir -p "$STAGING/usr/share/doc/obscura-simple"
cat > "$STAGING/usr/share/doc/obscura-simple/changelog.Debian" <<EOF
obscura-simple (${DEB_VERSION}) stable; urgency=low

  * Release ${VERSION} (simple-ui)

 -- Obscura Repository Signer <packages@obscura.com>  $(date -uR)
EOF
gzip -9n "$STAGING/usr/share/doc/obscura-simple/changelog.Debian"

INSTALLED_SIZE="$(du -sk "$STAGING" | cut -f1)"

cat > "$STAGING/DEBIAN/control" <<EOF
Package: obscura-simple
Version: ${DEB_VERSION}
Section: net
Priority: optional
Architecture: ${ARCH}
Maintainer: Obscura Repository Signer <packages@obscura.com>
Depends: libc6 (>= 2.39), passwd, util-linux-extra, libtss2-esys-3.0.2-0t64, libtss2-mu-4.0.1-0t64, libtss2-sys1t64, libtss2-tctildr0t64, libtss2-tcti-device0t64, desktop-file-utils, libgtk-4-1, libadwaita-1-0, libwebkitgtk-6.0-4, libsoup-3.0-0
Description: Obscura VPN (simple UI, ready-to-use)
 Privacy that's more than a promise.
 Single package with CLI + GUI (simple HTML UI), service and preset.
Installed-Size: ${INSTALLED_SIZE}
EOF

cat > "$STAGING/DEBIAN/postinst" <<'POSTINST_EOF'
#!/bin/sh
set -e
# create obscura group via systemd-sysusers or fallback
if command -v systemd-sysusers >/dev/null 2>&1; then
    systemd-sysusers || true
else
    if ! getent group obscura >/dev/null 2>&1; then
        groupadd --system obscura || true
    fi
fi
# ensure state dirs exist with correct perms (in case sysusers didn't create yet)
mkdir -p /var/lib/obscura /var/log/obscura || true
chgrp obscura /var/lib/obscura /var/log/obscura || true
chmod 770 /var/lib/obscura /var/log/obscura || true

# systemd enable + start (ready-to-use)
if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload || true
    # preset enables via 80-obscura.preset, fallback to enable
    systemctl preset obscura.service 2>/dev/null || systemctl enable obscura.service 2>/dev/null || true
    if [ "$1" = "configure" ]; then
        if [ -z "$2" ]; then
            # fresh install
            systemctl start obscura.service 2>/dev/null || true
        else
            # upgrade: try-restart if active
            if systemctl is-active --quiet obscura.service 2>/dev/null; then
                systemctl try-restart obscura.service 2>/dev/null || true
            else
                systemctl start obscura.service 2>/dev/null || true
            fi
        fi
    fi
fi

# apparmor reload if needed
if command -v apparmor_parser >/dev/null 2>&1 && [ -f /etc/apparmor.d/obscura-gui ]; then
    apparmor_parser -r /etc/apparmor.d/obscura-gui 2>/dev/null || true
fi

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database -q 2>/dev/null || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor 2>/dev/null || true
fi

# hint about group membership
if [ "$1" = "configure" ] && [ -z "$2" ]; then
    USER_TO_CHECK="${SUDO_USER:-}"
    if [ -n "$USER_TO_CHECK" ] && ! id -nG "$USER_TO_CHECK" 2>/dev/null | grep -qw obscura; then
        echo "NOTE: $USER_TO_CHECK not in 'obscura' group. Run: sudo obscura add-operator $USER_TO_CHECK" >&2
        echo "      then: newgrp obscura  (or logout/login)" >&2
    fi
fi
exit 0
POSTINST_EOF
chmod 755 "$STAGING/DEBIAN/postinst"

cat > "$STAGING/DEBIAN/prerm" <<'PRERM_EOF'
#!/bin/sh
set -e
if [ "$1" = "remove" ] && command -v systemctl >/dev/null 2>&1; then
    systemctl stop obscura.service 2>/dev/null || true
fi
exit 0
PRERM_EOF
chmod 755 "$STAGING/DEBIAN/prerm"

cat > "$STAGING/DEBIAN/postrm" <<'POSTRM_EOF'
#!/bin/sh
set -e
if [ "$1" = "purge" ] && command -v systemctl >/dev/null 2>&1; then
    systemctl disable obscura.service 2>/dev/null || true
fi
if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload 2>/dev/null || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database -q 2>/dev/null || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor 2>/dev/null || true
fi
exit 0
POSTRM_EOF
chmod 755 "$STAGING/DEBIAN/postrm"

# triggers for desktop/icon
mkdir -p "$STAGING/DEBIAN"
cat > "$STAGING/DEBIAN/triggers" <<'TRIG_EOF'
interest desktop-database
interest hicolor-icon-theme
TRIG_EOF

echo "=== Building .deb ==="
rm -f "$OUT"
dpkg-deb --build "$STAGING" "$OUT"
ls -lh "$OUT"
echo "Built $OUT"

if command -v lintian >/dev/null 2>&1; then
  echo "=== lintian ==="
  lintian --allow-root --suppress-tags no-manual-page,description-starts-with-package-name --fail-on error,warning "$OUT" || echo "lintian warnings (see above)"
else
  echo "lintian not installed, skipping"
fi

echo "To install: sudo apt install \"$OUT\""
echo "Then: sudo obscura add-operator \$USER && newgrp obscura && systemctl status obscura.service && obscura-gui"
