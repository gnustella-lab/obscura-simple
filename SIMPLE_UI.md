# Obscura Simple UI

A lightweight, intuitive HTML/CSS/JS replacement for the React/Mantine `obscura-ui`.

## Features

- **Vanilla JS** (~26K `app.js` + 5.8K `style.css` + 12K `index.html`) – no Node dependencies at runtime
- **Same Rust bridge** (`window.webkit.messageHandlers.commandBridge.postMessage`) as the original – uses `getOsStatus` long-poll, `jsonFfiCmd` for all `ManagerCmd` (login, status, exit list, DNS, etc.), `startTunnel`/`stopTunnel`
- **Views:** Connection (quick connect, city select, progress, session), Location (search, pinned, last used, grouped by country), Account (status, copy/reveal, logout/delete), Settings (auto-connect, local network, DNS blocking, appearance), Help (debug bundle), About, Developer
- **Account handling:** Verhoeff checksum (same as `accountUtils.ts`), `normalizeAccountId` strips dashes/spaces, `generateAccountNumber` via `crypto.getRandomValues`
- **Integration:** `simple-ui/` is packaged via `rustlib/gen-gresource-xml.py` → `webui.gresource` (43K vs 1.6M React) + `icons.gresource`, built with `OBSCURA_GRESOURCES_DIR=/tmp/obscura-gresources cargo build --features gui --bin obscura-gui`

## Build

```bash
# 1. Generate gresources from simple-ui
mkdir -p /tmp/obscura-gresources
glib-compile-resources --sourcedir=rustlib/src/gui --target=/tmp/obscura-gresources/icons.gresource rustlib/src/gui/icons.gresource.xml
python3 rustlib/gen-gresource-xml.py simple-ui /tmp/webui.generated.xml
glib-compile-resources --target=/tmp/obscura-gresources/webui.gresource /tmp/webui.generated.xml

# 2. Build GUI
OBSCURA_VERSION=v1.177 OBSCURA_GRESOURCES_DIR=/tmp/obscura-gresources cargo build --features gui --bin obscura-gui

# Or use helper
./simple-ui/rebuild.sh
```

## Run

```bash
# Service (systemd or manual)
sudo rm -f /run/obscura.sock /run/obscura-live-groups.sock
./run-service-native.sh          # keeps running, needs sudo
# In another terminal
newgrp obscura                   # only needed once after usermod
./run-cli-native.sh status
./run-cli-native.sh login 46638105944586912109
WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 ./run-gui-native.sh
# Or installed
WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 /usr/bin/obscura-gui
```

## Debian Package

A complete `.deb` with the simple UI is built via:

```bash
# Release binaries
OBSCURA_GRESOURCES_DIR=/tmp/obscura-gresources cargo build --release --locked --bin obscura
OBSCURA_GRESOURCES_DIR=/tmp/obscura-gresources cargo build --release --features gui --bin obscura-gui

# Then dpkg-deb (see /tmp/deb-build for staging)
dpkg-deb --build /tmp/deb-build/staging ./obscura-simple_1.177-1_amd64.deb
sudo apt install ./obscura-simple_1.177-1_amd64.deb
```

Package `obscura-simple` (24M) contains:
- `usr/bin/obscura` + `usr/bin/obscura-gui` (release, simple UI)
- `usr/lib/systemd/system/obscura.service`
- `usr/share/applications/net.obscura.vpn.gui.desktop`, icons, metainfo, apparmor

## Differences from React UI

- No Framer Motion, Mantine, or Vite build step at runtime
- No animations, but same polling intervals (osStatus long-poll, exit list 60s, account 30s, traffic 1s)
- Account creation still uses same Verhoeff and `payUrl` (`https://obscura.com/pay#account_id=`)
- Navigation via hash (`#connection`, `#location`, etc.) and `setNavigationView` sync
