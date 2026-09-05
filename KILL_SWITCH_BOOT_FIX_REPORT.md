# Boot protection correction — 2026-09-04

**The reproduced boot escape is fixed in the tested package.** Two protected
boots captured zero unmarked DNS, UDP or TCP packets outside the tunnel. The
pre-fix package had leaked 114 and 93 packets on the same Ubuntu VM setup.

## Change

The shared `linux/common/obscura.service` unit now starts after local filesystems
and system user creation, but before `network-pre.target`. Its normal late-start
dependencies were replaced with explicit boot/shutdown ordering. It retains
`Type=notify`; readiness is not released while boot protection is retrying.

`rustlib/src/bin/obscura/service/os/linux/boot.rs` reads the saved
`feature_flags.killSwitch` setting before normal manager initialization. When
enabled, it installs the existing nftables blocking rules and waits for kernel
acknowledgement before the service announces readiness. This stage needs neither
DNS nor a live VPN. LAN exceptions are restored later by the normal configuration
path, avoiding an early relaxation of an adopted tunnel's DNS restrictions.

Missing/disabled preferences preserve the existing default behavior. They do not
clear an adopted ruleset during restart. Unreadable or malformed preferences are
not interpreted as disabled: protection is retained, readiness is withheld, and
the file is retried. Restoring valid configuration lets initialization continue.
No additional firewall table, package dependency or second service was introduced.

## Validation

18 Rust unit tests and 3 isolated nftables/TUN tests passed. The new tests cover
persisted config defaults and errors, protection before the Linux constructor
returns, and preservation of an existing block when startup reads a disabled flag.
`systemd-analyze verify` passed for the shared and installed units.

The rebuilt Debian package was installed in a fresh Ubuntu 24.04 KVM guest using
the packaged system service, two virtual NICs and a real VPN connection. The
host installation was not upgraded. Capture used the same early-boot probe that
reproduced the failure, plus marked positive controls.

| Scenario | Result | Unmarked packets observed outside VPN | Captured controls |
| --- | --- | ---: | ---: |
| Enabled boot, first run | PASS | 0 | 494 |
| Enabled boot, repeat | PASS | 0 | 504 |
| Disabled boot, positive control | PASS: traffic intentionally allowed | 738 | 492 |
| Unexpected tunnel loss and reconnect | PASS | 0 | 930 |
| Network change `ens2` → `ens3` and return | PASS | 0 | 992 |
| ACPI deep suspend/resume | PASS | 0 | 188 |
| Packaged-service SIGKILL and restart | PASS | 0 | 456 |
| Invalid config during restart, then restoration | PASS | 0 | 332 |

VPN egress was externally confirmed after recovery. The invalid-config scenario
observed `ActiveState=activating` while the file was malformed, then recovered
to connected/blocking after restoration. Its first exploratory check polled the
IPC socket before it had been recreated; the final check correctly waited for
service initialization and was repeated successfully.

In the first protected boot, the firewall acknowledgement occurred at **2.850 s**
after kernel startup and systemd readiness at **2.855 s**, before network
preparation completed. Previously the first acknowledgement occurred at 5.749 s,
after traffic had already escaped. Both protected PCAPs were independently read
to confirm zero DNS probe payloads, UDP probe payloads or TCP SYNs. The disabled
PCAP contained 246 of each, establishing the positive control.

## Artifacts

Evidence is in `/tmp/obscura-boot-fix`: named JSON results and PCAPs for each
scenario, `lifecycle-result.json`, `snapshot.json`, `guest-environment.txt`, and
`boot-enabled-first-timeline.txt`. The original failing evidence remains in
`/tmp/obscura-vm-validation` and is described in
[the pre-fix lifecycle report](KILL_SWITCH_LIFECYCLE_REPORT.md).

- Guest kernel: `6.8.0-138-generic`; systemd `255.4-1ubuntu8.17`.
- Package: `obscura-simple 1.177-8`, rebuilt from the corrected working tree.
- Package SHA-256: `23186320c69b3de7d3afe8da840fce6e70e269523917cffe8eee166db81cf5df`.
- Installed service SHA-256: `5460e86d81b9ad34070087253da31bbf5ca933da36f0de7ef1ba2e2d058c43e8`.
- Candidate package: `/tmp/obscura-boot-fix/share/obscura-validation.deb`.

These results cover the tested Ubuntu/KVM environment, not physical Wi-Fi
drivers, every distribution, or networking configured in an initramfs before
local filesystems and normal systemd startup.

The guest VPN was disconnected and logged out, the VM shut down, and its writable
disk removed to discard temporary account state and keys. The temporary package
server was stopped. The host service retained PID `114553` and its original
installed binary; the corrected candidate has not been installed on the host.
