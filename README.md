# Obscura Simple

A Linux desktop client for Obscura VPN — **no Electron**.

The GUI is a native Linux app built with **GTK 4 + libadwaita**, rendering its lightweight HTML/CSS/JavaScript interface with the system's **WebKitGTK**. No bundled Chromium, no Node.js runtime — just the existing Rust VPN backend behind a native shell.

> [!NOTE]
> Because it reuses your distro's WebKitGTK and GTK libraries, the `.deb` is about 24 MB and follows your GNOME light/dark theme instead of shipping a whole browser.

This is an independent fork of [Sovereign-Engineering/obscuravpn-client](https://github.com/Sovereign-Engineering/obscuravpn-client), based on upstream `v1.177` with its commit history preserved. It is not the official Obscura client. This fork's UI, documentation, and release notes are maintained in English.

## Current release

**[Obscura Simple 1.177-16](https://github.com/gnustella-lab/obscura-simple/releases/tag/v1.177-simple-16)** adds isolated Linux packaging and a Flatpak frontend.

| Artifact | Purpose |
| --- | --- |
| `obscura-simple_1.177-16_amd64.deb` | Host service, CLI and native GUI for Ubuntu 24.04-compatible systems |
| `obscura-simple_1.177-16_x86_64.flatpak` | Sandboxed GUI, requires the matching Simple host service |
| `SHA256SUMS` | SHA-256 checksums for both downloads |

- [Download the .deb](https://github.com/gnustella-lab/obscura-simple/releases/download/v1.177-simple-16/obscura-simple_1.177-16_amd64.deb)
- [Download the Flatpak](https://github.com/gnustella-lab/obscura-simple/releases/download/v1.177-simple-16/obscura-simple_1.177-16_x86_64.flatpak)
- [Download SHA256SUMS](https://github.com/gnustella-lab/obscura-simple/releases/download/v1.177-simple-16/SHA256SUMS)
- [Release notes](release-notes/v1.177-simple-16.md)

Release binaries are attached to GitHub releases, not committed to this repository. `tag.json` tracks upstream `1.177`; the Debian revision and `v1.177-simple-N` tags identify fork releases.

## Install or upgrade

The older `1.177-15` package uses upstream file paths and must not be
installed alongside official Obscura packages. Release `1.177-16`
introduces separate executables, IPC sockets, GTK application identity,
autostart entry, operator group, service and persistent state.

Build the isolated package with the command below, then install it explicitly:

```bash
CARGO_BUILD_JOBS=2 ./contrib/bin/build-simple-deb.bash
sudo apt install ./obscura-simple_1.177-16_amd64.deb
sudo obscura-simple add-operator "$USER"
obscura-simple-gui
```

Installation does not start, restart or enable either VPN service. The launcher
is **Obscura Simple (Unofficial)**. Its UI and settings are not the official
Linux Alpha UI and do not share the official app's saved account or preferences.
No account data is migrated automatically from old shared directories.

Only one VPN backend may run at a time: both retain `/run/obscura.lock`, acquired
before firewall, tunnel and DNS initialization. The separate package identity
allows both apps to be installed, not both backends to control networking.
The Simple installer and GUI do not stop the official service or silently take
over its boot activation. Starting Simple while the official backend owns the
lock fails before network changes. Do not enable both services at boot.

Changing the active backend can interrupt connectivity and kill-switch protection.
When you deliberately choose Simple instead of the official service, stop the
official service yourself first, then start `obscura-simple.service`. Review boot
activation separately; Simple's service is disabled by default, so its historical
boot-protection guarantees apply only after explicitly configuring it for boot.

```bash
sudo systemctl start obscura-simple.service
systemctl status obscura-simple.service --no-pager
obscura-simple login
obscura-simple status
```

A paid Obscura account is required for VPN service. Existing accounts can be used,
but sign in separately in Simple. With its kill switch enabled, disconnecting
intentionally leaves internet blocked until you change that setting.

Legacy `1.177-15` package scripts and residual configuration predate isolation.
Do not purge the legacy package while relying on the official service without
reviewing its `postrm`: it can disable `obscura.service`. Do not delete shared
`/var/lib/obscura` or `~/.config/obscura` data as part of migration.

## Flatpak

The Flatpak is **not a standalone VPN backend**. It runs the GUI inside the
sandbox and communicates only with the matching `obscura-simple 1.177-16`
host service. The official Alpha service is a different backend and cannot
satisfy this dependency. Other distributions currently need a separately
installed matching Simple host service; the provided host package targets
Ubuntu 24.04-compatible systems.

1. Download both packages and `SHA256SUMS`, then verify with `sha256sum -c SHA256SUMS`.
2. Install the host `.deb` and add yourself to its operator group as described above.
3. When deliberately switching away from another VPN backend, stop it yourself and start `obscura-simple.service`. Never enable both services at boot.
4. Install the Flatpak and launch it:

```bash
flatpak install --user ./obscura-simple_1.177-16_x86_64.flatpak
flatpak run io.github.gnustella_lab.obscura_simple
```

The bundle uses **GNOME Platform 50** from Flathub. The runtime is downloaded
separately if needed; it is not included in the `.flatpak` file. Single-file
bundles do not provide an automatic application update repository.

Only the two Simple IPC sockets are exposed, read-only, alongside the display,
network, tray and a filtered systemd D-Bus connection. There is no full-home,
full-system-bus or arbitrary host-command permission. Start the host service
before launching the GUI. **Close and reopen the Flatpak after a service
restart**, since file-mounted Unix sockets can retain the old inode.

Host setup, operator permissions, native autostart registration and complete
host debug archives are not performed from the sandbox. The UI explains these
limits rather than presenting nonworking controls. Use your desktop's Startup
Applications settings with `flatpak run io.github.gnustella_lab.obscura_simple`
for GUI autostart. For diagnostics, run `obscura-simple debug-bundle "description"`
in a host terminal. Starting the GUI at login is separate from enabling the
host VPN service at boot.

### Build the Flatpak

```bash
CARGO_BUILD_JOBS=1 ./contrib/bin/build-simple-deb.bash
./contrib/bin/build-simple-flatpak.bash
```

The Flatpak builder packages the **same source-built native GUI executable**
from the `.deb` and executes an ABI/version probe inside GNOME Platform 50
before exporting the bundle. It does not rebuild Rust inside a Flatpak SDK or
bundle a host-executing launcher. `flatpak` and the GNOME Platform 50 runtime
must already be installed. No `flatpak-builder` or extra compiler SDK is needed.

## Interface

![Connection screen with the official-style layout](previews/official-ui/connection.png)

*Preview using sample data. [All screenshots](previews/official-ui/) and an [HTML gallery for local viewing](previews/official-ui/index.html) are included in the repository.*

The current UI follows the official app's visual style while retaining this fork's Linux functionality:

- **Connection:** Quick Connect, expandable country and city selection, session information, and a protection status panel. Background pixels fill orange from bottom to top when connecting, with cancellation and reduced-motion support.
- **Location:** searchable city cards displayed directly under region headings, last-chosen and pinned locations, keyboard activation, and local SVG country flags.
- **Account:** subscription status, masked/revealed account number, copying, payment and WireGuard configuration links, logout, and account deletion.
- **Settings:** launch at login, auto-connect, kill switch, local network access, key rotation, DNS blocking, and appearance controls.
- **Help:** diagnostic archive creation, an optional problem description, support contact, and social links.
- **About:** official artwork and wordmark, the running version, source/license links, and a link to the latest GitHub release. The update button opens the release page; it is not an automatic updater.
- **Developer:** available by clicking the version five times in About; the native sidebar also supports `Ctrl+Shift+D`.

The GTK sidebar and backend navigation state stay synchronized. A matching web sidebar is used for browser previews and hidden inside the native app, avoiding duplicate navigation. Light and dark themes share the same orange accent; orange buttons use white text and a white Quick Connect icon in both themes. Connection background pixels have square corners and no gaps, including in narrow layouts.

Connection background animation can follow the system preference, animate bottom to top, or remain static. Choose **Settings → Appearance → Connection background animation → Animate bottom to top** to enable the effect only in this app when desktop animations are disabled. The default follows the system preference.

The `1.177-15` UI prevents tab changes from restarting the Connection animation. The eight-row background follows tunnel events: connecting fills the squares, disconnecting clears them, and reconnecting starts a new reveal. Fifteen automated tests passed, including navigation regression tests. WebKit checks confirmed that completed CSS animations survive tab changes without restarting.

## Kill switch status

The kill switch is a regular setting; its experimental label was removed in `1.177-9`. The backend is unchanged in `1.177-15`.

When enabled, the packaged system service reads the saved preference and installs blocking rules **before network preparation at boot**. It announces readiness only after the kernel acknowledges those rules. Invalid or unreadable preferences retain protection while initialization retries. DNS setup failures cannot bypass firewall installation, and the systemd descriptor store preserves the firewall socket across service crashes and restarts.

The UI distinguishes a VPN connection, internet blocked by the kill switch, and protection that has not been confirmed. A saved preference is not displayed as proof that firewall installation succeeded.

### Validation scope

The kill switch changes passed 18 Rust unit tests and 3 isolated nftables/TUN tests. Package-level lifecycle validation used an Ubuntu 24.04 KVM guest, kernel `6.8.0-138-generic`, systemd `255.4-1ubuntu8.17`, and a real VPN connection.

Two corrected protected boots captured **zero unmarked DNS, UDP, or TCP packets outside the tunnel**. The disabled-kill-switch control allowed traffic as expected. Tunnel loss/reconnection, network switching, deep suspend/resume, service crash/restart, and invalid-configuration recovery also passed without observed leaks.

These results describe the tested environment, not every distribution, physical Wi-Fi driver, suspend implementation, or network configured in an initramfs before normal systemd startup. Boot ordering depends on the packaged unit; manually launching a service after the network is already active does not provide the same startup ordering.

- [Boot correction and validation report](KILL_SWITCH_BOOT_FIX_REPORT.md)
- [Test commands and coverage](KILL_SWITCH_TESTING.md)
- [Historical pre-fix failure report](KILL_SWITCH_LIFECYCLE_REPORT.md)

The `1.177-10` UI was additionally checked across all six screens, light/dark themes and narrow layouts, including navigation, search, pinning, account-number masking, protection states, keyboard controls, and pixel animation behavior. Both release executable versions, the embedded UI, installation scripts, and the downloaded GitHub artifact were verified.

## Build from source

Run the following commands from the repository root. Native builds require Rust/Cargo, Python 3.12+, a C build toolchain, `pkg-config`, GLib resource tools, and development libraries for GTK 4, libadwaita, WebKitGTK 6, libsoup 3, and TPM2/TSS. Creating the package also requires `dpkg-deb`. The installed package's runtime dependencies are declared in [the build script](contrib/bin/build-simple-deb.bash).

### Build the `.deb`

```bash
CARGO_BUILD_JOBS=1 ./contrib/bin/build-simple-deb.bash
# Output: ./obscura-simple_1.177-16_amd64.deb on an amd64 host
```

This generates the Simple UI resources, builds both release binaries with matching versions and the `simple-client` feature, and stages the isolated package and passive installation scripts. Nix and Docker are not required for this path. One build job is useful on machines with limited RAM.

### Develop the GUI

```bash
./simple-ui/rebuild.sh
./rustlib/target/debug/obscura-gui
```

The helper generates resources and builds the debug GUI. It expects the service to be running. Keep the GUI and service version strings identical; the helper accepts an `OBSCURA_VERSION` override for development.

To build a matching debug CLI/service binary:

```bash
OBSCURA_VERSION=v1.177-16 cargo build \
  --manifest-path rustlib/Cargo.toml --locked --features simple-client --bin obscura
```

For the detailed UI structure and additional development commands, see [SIMPLE_UI.md](SIMPLE_UI.md). The native wrappers in the repository are development helpers, not the recommended installation path.

## Run checks

```bash
node --check simple-ui/app.js
node --test simple-ui/official-ui.test.cjs \
  simple-ui/pixel-animation.test.cjs simple-ui/kill-switch.test.cjs

cargo test --manifest-path rustlib/Cargo.toml --release --locked --features simple-client,gui --lib --bin obscura
python3 contrib/bin/test-simple-package.py obscura-simple_1.177-16_amd64.deb

# With the package installed:
systemd-analyze verify /usr/lib/systemd/system/obscura-simple.service

# Kernel integration checks in isolated namespaces:
bash contrib/bin/linux-kill-switch-test.bash
```

Node is used for development checks, not required to run the installed app. The kernel runner requires namespace/netlink access and `/dev/net/tun`; it uses Cargo's offline mode, so Rust dependencies must already be available. Kernel tests are intentionally ignored by ordinary `cargo test` and run explicitly by the isolated runner. See [KILL_SWITCH_TESTING.md](KILL_SWITCH_TESTING.md) for systemd and VM validation details.

## Troubleshooting

For service startup or connection problems:

```bash
obscura-simple status --json
systemctl status obscura-simple.service --no-pager
journalctl -u obscura-simple.service -n 100 --no-pager
```

A service that remains `activating` may be retrying configuration or firewall setup. Check its logs rather than assuming it is crash-looping. A version mismatch usually means the GUI needs reopening after an upgrade or development binaries were built with a different `OBSCURA_VERSION`.

For fork-specific bugs, use [this repository's issue tracker](https://github.com/gnustella-lab/obscura-simple/issues). For the Obscura VPN service, account, or billing, contact [support@obscura.net](mailto:support@obscura.net). Do not include account numbers or credentials in public reports.

## Repository scope

| Path | Purpose |
| --- | --- |
| `simple-ui/` | Vanilla frontend, local artwork/flags, and UI tests |
| `rustlib/src/gui/` | Native GTK/WebKit shell and command bridge |
| `rustlib/src/bin/obscura/service/` | System service and Linux network integration |
| `linux/common/` | Shared service unit, desktop integration, and icons |
| `contrib/bin/build-simple-deb.bash` | This fork's single-package Debian build |
| `previews/official-ui/` | Screenshots and local preview gallery |
| `obscura-ui/` | Retained upstream React/Mantine interface and assets |
| `docs/` | Upstream conventions, terminology, and architecture |

Upstream-derived Nix/container workflows, split Debian/RPM/Arch packaging, and signing utilities remain in `contrib/` and `linux/`. Their presence does not imply that this fork publishes signed distribution repositories or has validated every upstream platform. The current published artifact is the amd64 `.deb` linked above. Use this fork's GitHub release assets rather than the upstream repository deployment instructions.

## License

See [LICENSE.md](LICENSE.md) for the PolyForm Noncommercial License 1.0.0. Upstream code and artwork retain their respective notices.
