# Kill switch lifecycle validation — 2026-09-04

This is the historical pre-fix report. The boot defect was subsequently corrected
and retested; see [the boot fix report](KILL_SWITCH_BOOT_FIX_REPORT.md).

**Release decision: retain the experimental label. Boot protection failed.**

The corrected `obscura-simple` package was built and installed in a disposable
Ubuntu 24.04 VM, using the packaged system service and a real VPN connection.
The host installation was not upgraded or interrupted. The VM used its own keys
with the configured account. An external exit check confirmed VPN egress before
fault injection and after recovery.

## Results

| Scenario | Result | Evidence |
| --- | --- | --- |
| Unexpected tunnel loss | PASS | Temporarily dropped service-marked transport; observed connected → connecting → connected; 2,376 unmarked probe attempts, zero leaks. |
| Network change | PASS | Disabled the first virtual NIC; verified marked traffic moved from `ens2` to `ens3`; restored it; 570 unmarked attempts, zero leaks. |
| Suspend/resume | PASS | QMP reported `suspended`; kernel logged `PM: suspend entry (deep)` and `PM: suspend exit`; VPN usable afterward; 366 unmarked attempts, zero leaks. |
| Packaged system service crash/restart | PASS | One `SIGKILL` and one `systemctl restart`, both with real VPN connected; new PIDs, VPN recovered; 708 unmarked attempts, zero leaks. |
| Boot with persisted kill switch | **FAIL** | Two normal boots leaked **114** and **93** generated packets before the firewall took effect. Protection was active afterward. |

Probes used IPv4/IPv6 DNS queries, UDP datagrams and TCP SYNs. An AF_PACKET socket
observed outgoing traffic on the VM's two physical NICs, excluding the VPN TUN.
Unmarked test traffic was distinguished from explicitly marked control traffic.
A pre-firewall baseline verified that all six protocol/family combinations were
visible. Permitted control packets were also observed during protected tests.
These are sampled tests, not a proof covering every possible timing or hardware.

## Confirmed boot failure

The kill switch was enabled before reboot and remained enabled afterward.
An early-boot probe service started before `network-pre.target`, representing
traffic from services that run before the VPN daemon. It did not delay the VPN
unit or change its dependencies.

In the repeated normal boot:

| Event | Seconds after kernel startup |
| --- | ---: |
| Probe process started | 2.034 |
| First captured unmarked packet | 3.344 |
| VPN daemon logged startup | 5.157 |
| Configuration loaded | 5.590 |
| Last captured unmarked packet | 5.674 |
| nftables ruleset acknowledged | 5.749 |

The PCAP contains **31 DNS queries, 31 UDP probes and 31 TCP SYNs** outside the
tunnel: 24 of each over IPv4 and 7 of each over IPv6. The SYN count was separately
checked with `tcpdump`; DNS and UDP payload counts were checked from the PCAP.
After protection engaged, the backend reported `firewallStatus=blocking`; a
subsequent VPN connection and exit check succeeded.

The packaged unit starts after `network.target`. Firewall rules are applied
later, after service initialization and configuration loading. The systemd FD
store preserves the nftables socket during service restarts, but does not carry
kernel firewall state through a machine reboot. Consequently, the current
implementation does not protect traffic generated before initial rule setup.

The first exploratory boot had a VM network configuration error that caused a
two-minute wait for a nonexistent interface. That run is preserved separately
as `boot-initial.json` and is **not** used for the normal-boot counts above. The
secondary interface was given a stable name and made optional, then two normal
boots reproduced the leak without that delay.

The release blocker is installing fail-closed protection before network traffic
can leave at boot, while preserving the existing DNS, routing and service
recovery behavior. Re-run the lifecycle tests after that change. This task
validated behavior; it did not change the boot implementation.

## Snapshot and artifacts

- Ubuntu minimal cloud image SHA-256: `d2ed9bebd51635f75b48ef0b27a58f03e27a32a2a6544c507d117d323eeac714`.
- Guest kernel: `6.8.0-138-generic`; systemd `255.4-1ubuntu8.17`.
- Installed package: `obscura-simple 1.177-8`, rebuilt from the current working tree.
- Package SHA-256: `62e1b469f22926150488b0eacf1088b321926afa43179e9b189f2d4f41552340`.
- Installed service binary SHA-256: `07a1cf96641ea7f7e0624a3729807aede6fdb7e0af7708e1979cc4cbd4c50a0b`.
- Boot PCAP SHA-256: `c421912277468fbab9d24e4cd759eb38c4fedadd6cf71e3086b3811f98ebb63b`.

Evidence directory: `/tmp/obscura-vm-validation`.
It contains `snapshot.json`, `guest-environment.txt`, per-scenario JSON counters
and result files, `boot-normal-first.json`, `boot.json`, `boot.pcap`, and
`boot-service-timeline.txt`. `lifecycle-result.json` records the aggregate failure
and cleanup. The test orchestration is preserved in `control.py`
and `phases.py`; the probe source is in
`contrib/bin/linux-kill-switch-traffic-probe.py`.

This validates virtual hardware on this Ubuntu release. Physical Wi-Fi drivers,
other distributions and other suspend implementations were not exercised.

The test VPN was disconnected and logged out, the VM shut down, and its writable
disk removed to discard temporary account state and keys. The local package
server was stopped. The host VPN service retained PID `114553` and its original
installed binary; the rebuilt candidate was not installed on the host.
