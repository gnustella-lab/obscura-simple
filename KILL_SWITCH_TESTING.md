# Linux kill switch validation

Run from the repository root:

```sh
cargo test --manifest-path rustlib/Cargo.toml --lib --bin obscura --offline
node --test simple-ui/kill-switch.test.cjs
bash contrib/bin/linux-kill-switch-test.bash
```

The last command builds the test executable and runs each kernel test in a new
user, network and mount namespace. It mounts a private `/run`, disconnects the
test process from system D-Bus and systemd notifications, and creates a dummy
network interface. It does not change the host firewall or service. It requires
`ip`, `unshare`, `mount`, `timeout`, nftables kernel support and `/dev/net/tun`.
Environments that restrict netlink sockets must allow those operations for this
isolated command. No VPN account or internet connection is needed.

`--firewall-only` runs the nftables test without requiring a TUN device. It is
partial validation, not a substitute for the full command. The default command
fails if the TUN test cannot run. Kernel tests are explicitly ignored by normal
`cargo test`; the isolated runner executes them with `--ignored`.

## Automated coverage

- IPv4 and IPv6 UDP traffic, including DNS, is rejected outside VPN tunnels.
- Service-marked traffic remains permitted.
- The local-network setting controls access to a private-address DNS server.
- Disabling and re-enabling the block changes actual kernel behavior.
- A rejected atomic ruleset update preserves the previous blocking rules.
- Missing DNS management does not prevent service initialization or firewall
  application when connecting or disconnecting.
- Firewall status changes only after nftables acknowledges the operation;
  failures are reported conservatively even if the previous rules remain active.
- Status updates reach manager subscribers and old status messages default to
  an unknown firewall state.
- Connecting without a network interface still attempts protection and retries
  after failure.
- The UI displays applied firewall state separately from the saved preference.

## Crash and restart under systemd

```sh
cargo build --manifest-path rustlib/Cargo.toml --bin obscura --offline
python3 contrib/bin/linux-kill-switch-systemd-test.py rustlib/target/debug/obscura
```

This uses a transient **user** systemd unit and the real service executable.
The unit uses `Type=notify`, `NotifyAccess=main`, `FileDescriptorStoreMax=8`,
`Restart=always` and `RestartSec=1`. A separate keeper preserves private network
and mount namespaces across process deaths. The test has its own config, IPC
sockets, `/run` and dummy interface. It preserves access to the user's systemd
notification socket without changing the installed VPN service. DNS management
is disabled and no account or live relay is used.

The runner performs three `SIGKILL` crashes with automatic recovery and three
`systemctl --user restart` operations. It verifies changed PIDs, automatic restart
counters, a nonempty FD store, socket adoption in the journal, and the backend's
confirmed firewall status after each restart. Connected UDP probe sockets remain
open across all six transitions. Repeated TCP connection attempts are checked
using packet capture: `connect_ex` alone can return `EINPROGRESS` for dropped SYNs.
A pre-firewall baseline verifies IPv4/IPv6 UDP and SYN visibility, and marked UDP
control traffic must continue to pass during the protected phase.

The transient unit is stopped and the keeper terminated afterward. Evidence is
written to the printed `/tmp/obscura-systemd-test-*` directory: `baseline.json`,
`traffic.json`, `result.json` and `journal.txt`. `result.json` includes the tested
binary's SHA-256.

Validated on 2026-09-04 with systemd 255 (255.4-1ubuntu8.17):

- 3 crashes and 3 explicit restarts passed; 6 stored-socket adoptions.
- 8,460 unmarked UDP/DNS sends rejected across IPv4 and IPv6.
- 4,230 TCP connection attempts; no outgoing SYN observed while protected.
- 8,460 marked UDP control packets captured during protection.
- No observed UDP/DNS leak during the 5.23-second protected sampling period.
- Binary SHA-256: `c4887840911312247f702e94b5c2d8d995799db3b1786020503e6639c0543ae3`.

Evidence for this run: `/tmp/obscura-systemd-test-qo4kzmgm`.

## Remaining release validation

The original packaged-service VM run reproduced a boot leak of 114 and 93 packets;
see [the historical lifecycle report](KILL_SWITCH_LIFECYCLE_REPORT.md). The
correction now installs saved protection before network preparation and service
readiness. Two protected boots captured zero leaks; a disabled boot allowed
traffic as expected. Real-VPN drop/reconnect, network change, ACPI suspend/resume,
service crash/restart and invalid-config recovery also passed again. See
[the boot fix report](KILL_SWITCH_BOOT_FIX_REPORT.md) for hashes and PCAP evidence.

The isolated runner now includes `kill_switch_boot` to verify initialization
protection, invalid-config retry and preservation of adopted rules. Broader
release claims still require coverage of the supported distributions, physical
network/suspend implementations, existing connections and local-network settings.
Positive controls remain required so a broken test network cannot produce a
false pass.

The kernel-only namespace tests do not run systemd; the transient-unit tests
exercise real systemd but not the packaged system unit or a live VPN relay.
The separate VM runs cover those boundaries and the boot correction above.
The reported firewall state confirms the
application's acknowledged ruleset; it is not a continuous packet-capture audit.
