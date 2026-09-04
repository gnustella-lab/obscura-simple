# Obscura Simple UI

A lightweight, intuitive HTML/CSS/JS replacement for the React/Mantine `obscura-ui`.

## Features

- **Vanilla JS** (~28K `app.js` + ~6K `style.css` + ~12K `index.html`) – no Node dependencies at runtime
- **Same Rust bridge** (`window.webkit.messageHandlers.commandBridge.postMessage`) as the original – uses `getOsStatus` long-poll, `jsonFfiCmd` for all `ManagerCmd` (login, status, exit list, DNS, etc.), `startTunnel`/`stopTunnel`
- **Views:** Connection (quick connect, city select, progress, session), Location (search, pinned, last used, grouped by country), Account (status, copy/reveal, logout/delete), Settings (auto-connect, local network, DNS blocking, appearance, experimental kill switch), Help (debug bundle), About, Developer (5x click on the version in About)
- **Navigation:** the backend `osStatus.navigationView` is the source of truth, like the React UI — the native left sidebar and the web top bar stay in sync via `setNavigationView` and the `getOsStatus` long-poll; `location.hash` (`#connection`, `#location`, etc.) is only a mirror for refresh/deep-link
- **Dark theme** via `color-scheme: light dark` and the official robot logo (`simple-ui/logo.svg`) in the header, hero, and About views
- **Account handling:** Verhoeff checksum (same as `accountUtils.ts`), `normalizeAccountId` strips dashes/spaces, `generateAccountNumber` via `crypto.getRandomValues`
- **Integration:** `simple-ui/` is packaged via `rustlib/gen-gresource-xml.py` → `webui.gresource` (~80K vs 1.6M React) + `icons.gresource`, built with `OBSCURA_GRESOURCES_DIR=/tmp/obscura-gresources cargo build --features gui --bin obscura-gui`

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

## Debian Package (ready-to-use)

A complete `.deb` with the simple UI, service auto-enabled and auto-started:

```bash
# One command: builds gresources + release binaries + stages a proper Debian package
./contrib/bin/build-simple-deb.bash
# or: ./simple-ui/build-deb.sh
# outputs: ./obscura-simple_1.177-7_amd64.deb

sudo apt install ./obscura-simple_1.177-7_amd64.deb
systemctl status obscura.service   # -> active (running)
sudo obscura add-operator $USER    # add yourself to obscura group
newgrp obscura                     # or logout/login
obscura status
WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 obscura-gui
```

Manual equivalent (same as the script):

```bash
mkdir -p /tmp/obscura-gresources-simple
glib-compile-resources --sourcedir=rustlib/src/gui --target=/tmp/obscura-gresources-simple/icons.gresource rustlib/src/gui/icons.gresource.xml
python3 rustlib/gen-gresource-xml.py simple-ui /tmp/webui.generated.xml
glib-compile-resources --target=/tmp/obscura-gresources-simple/webui.gresource /tmp/webui.generated.xml
OBSCURA_VERSION=v1.177 OBSCURA_GRESOURCES_DIR=/tmp/obscura-gresources-simple cargo build --release --locked --bin obscura
OBSCURA_VERSION=v1.177 OBSCURA_GRESOURCES_DIR=/tmp/obscura-gresources-simple cargo build --release --features gui --bin obscura-gui
# then staging + dpkg-deb via the script above
```

Package `obscura-simple` (~24M) contains (ready-to-use):
- `usr/bin/obscura` + `usr/bin/obscura-gui` (release, simple UI)
- `usr/lib/systemd/system/obscura.service` + `usr/lib/systemd/system-preset/80-obscura.preset` (auto-enable via `systemctl preset`)
- `usr/lib/sysusers.d/obscura.conf` (creates `obscura` group)
- `usr/share/applications/net.obscura.vpn.gui.desktop`, icons, metainfo, apparmor
- `DEBIAN/postinst` that does `systemd-sysusers`, `daemon-reload`, `preset/enable` and `start` on fresh install, plus `prerm/postrm` handling

Official repo packages (`obscura-cli`/`obscura-gui` via `linux/deb`) are also fixed: `linux/deb/rules:5` now installs preset and `dh_installsystemd` enables+starts, so `apt install obscura` from the signed repo is similarly ready-to-use. Build them with simple UI via `contrib/bin/linux-build-binaries.bash --simple-ui --release --locked && ./contrib/bin/linux-build-packages.bash --test` (requires nix + docker).

## Troubleshooting `Service unavailable / unitActivating`

If the GUI shows `Service starting... unitActivating` after `apt install`:

```bash
systemctl status obscura.service   # should be active; if activating/failed, check journal
journalctl -u obscura.service -n 100 --no-pager
ls -l /run/obscura.sock            # 770, group obscura
id -nG $USER | tr ' ' '\n' | grep obscura || echo "not in group -> sudo obscura add-operator $USER && newgrp obscura"
```

Common causes fixed by the new packages: missing `obscura` group (`sysusers`), not enabled (`preset`), not started (`postinst`), stale sockets (`rm -f /run/obscura.sock` when no service running).

## Releases

Current package revision: `1.177-7`, producing `obscura-simple_1.177-7_amd64.deb`. Release assets are not committed. Versioning: `tag.json` tracks upstream (`1.177`); the `-N` suffix is the fork packaging revision.

## Differences from React UI

- No Framer Motion, Mantine, or Vite build step at runtime
- No animations, but same polling intervals (osStatus long-poll, exit list 60s, account 30s, traffic 1s)
- Account creation still uses same Verhoeff and `payUrl` (`https://obscura.com/pay#account_id=`)
- Navigation follows the backend `osStatus.navigationView` (same as `<Routes location={osStatus.navigationView}>`); the web top bar pushes via `setNavigationView` and mirrors the view in `location.hash` with `history.replaceState`
