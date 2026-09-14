# Historical Obscura Simple coexistence fixes

This records the `1.177-16` validation that motivated the isolated package
identities. It is historical: `1.177-17` is the current distribution and ships
one `.deb` containing the CLI, service and native GUI; it does not produce or
require Flatpak.

## Confirmed problems and corrections

- OS-001: the old package used the same CLI, GUI, service and desktop paths as the official packages. The final package has separate paths and passive installation scripts. Its payload has no file overlap with the installed official packages.
- OS-002: package renaming was insufficient because the GUI and service still shared IPC, identity, autostart, permissions and user storage. The `simple-client` build feature now isolates these resources. The shared service lock is deliberately retained so two VPN backends cannot control networking concurrently.
- OS-003: the fork's UI and package metadata were easy to confuse with the official Alpha. Launcher, window/tray names, About/Help copy, AppStream identity and service-recovery commands now identify Simple. The community UI is not presented as a reproduction of the official Alpha.

## Executed verification

- Release CLI and GUI compiled; both report `v1.177-16`.
- Real Debian payload, ownership, scripts, AppStream and desktop entry inspected.
- APT simulation: only Simple would be installed, no packages removed.
- JavaScript: 17 passed, 0 failed.
- Rust: 21 passed, 0 failed; 3 kernel/network integration tests intentionally ignored.
- Native GUI from the final .deb rendered in an isolated Xvfb/D-Bus session. Its D-Bus name and state/log namespace were verified. GUI and CLI traces target `/run/obscura-simple.sock`, never the official sockets.
- Official package integrity and binary hashes unchanged. `obscura.service` remains active/running with PID 65397.

- Flatpak installed in an isolated user installation, then launched as a real GTK/WebKit GUI. The host setup guidance rendered; host-only controls were absent.
- Flatpak and .deb contain the identical GUI executable. Runtime ABI, D-Bus identity and filtered permissions passed checks.
- Read-only Unix-socket mounts and host peer UID were exercised with a transport fixture, not a live VPN.

Package checksums are in the release asset `SHA256SUMS`.
Detailed findings, evidence and limitations are in `bugs-observed.json`.

## Safety and validation limits

The host Debian package was not installed, and no credentials or old shared settings were migrated. The Flatpak was installed only in an isolated test installation. The official Alpha was not removed, restarted or reconfigured. Only one backend can run: `/run/obscura.lock` is intentionally shared and acquired before firewall/TUN/DNS initialization. No live VPN switch, boot or leak test was performed.

Simple's service is not started or enabled during installation. Explicitly configuring boot activation is necessary before relying on boot kill-switch protection. Do not enable both backends at boot. Review legacy `1.177-15` maintainer scripts before purging residual configuration, since they predate isolation and may disable the official service.
