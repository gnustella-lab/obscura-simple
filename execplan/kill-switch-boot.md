# Protect traffic before network startup

## Purpose

When the saved Linux kill switch is enabled, ordinary traffic must be blocked
before network setup at boot. The prior package leaked 114 and 93 probe packets
on two normal Ubuntu VM boots. Keep the host installation unchanged and prove
the correction with the packaged service in an isolated VM.

## Progress

- [x] Traced the reproduced leak to late service startup and late nftables setup.
- [x] Apply saved boot protection before service readiness; preserve restart rules.
- [x] Move the packaged service before network-pre.target without a dependency cycle.
- [x] Run unit and isolated kernel regressions: 18 unit tests and 3 isolated kernel tests passed.
- [x] Build and install the candidate in a fresh VM; two protected boots, disabled control, all lifecycle scenarios and invalid-config recovery passed.
- [x] Record evidence and remove guest account state during cleanup.

## Surprises & Discoveries

The service currently announces readiness before loading configuration or
installing a firewall. Its nftables socket can survive a service crash via the
systemd descriptor store, but not a machine reboot. Starting the same service
early avoids a second firewall table and a risky handoff between two owners.

## Decision Log

Use the existing netfilter rules and saved config.json. Read only the kill switch
flag with strict deserialization before readiness. Initially deny LAN exceptions
until the normal manager applies the full configuration, so restarting an active
tunnel cannot briefly relax its DNS restrictions. If the flag is disabled, leave
adopted firewall rules untouched for the manager to reconcile. Read/application
errors retry before readiness, rather than assuming protection is disabled.

## Context and Orientation

linux/common/obscura.service is copied into the simple Debian package and the
other distro packages. Type=notify means systemd waits for READY=1 before starting
units ordered after this service. The LinuxOsImpl constructor in
rustlib/src/bin/obscura/service/os/linux/mod.rs owns the nftables socket and calls
notify_ready. NftTable in netfilter.rs applies atomic kernel rulesets and waits
for kernel acknowledgements. The manager later owns normal connection/config
transitions. The config's disk field is feature_flags.killSwitch, not the public
status field featureFlags.killSwitch.

## Plan of Work

First add boot.rs beside netfilter.rs to read the persisted flag and install a
conservative blocking ruleset using NftTable. LinuxOsImpl::new will accept the
config directory, perform boot protection before creating TUN and notifying
readiness, and expose the acknowledged initial firewall state. Update its two
callers. Validate missing/disabled/enabled/invalid configurations and a real
kernel test showing traffic is already blocked when construction returns.

Then set DefaultDependencies=no, order after local filesystems and sysusers, and
before network-pre.target and shutdown.target in the shared service unit. Pull
in network-pre.target, retain explicit shutdown conflict, and avoid a startup
timeout releasing the ordering barrier while protection is retrying.

Finally rebuild the release package, recreate the disposable QEMU VM from the
verified Ubuntu image, and use the existing guest-agent controls and physical-NIC
probe to capture early boot. Test enabled and disabled preferences, configuration
failure recovery, real VPN connection, network change, suspend and service restart.

## Concrete Steps

From the repository root:

    cargo test --manifest-path rustlib/Cargo.toml --lib --bin obscura --offline
    bash contrib/bin/linux-kill-switch-test.bash
    systemd-analyze verify linux/common/obscura.service

The kernel runner requires namespace/netlink access outside the sandbox. The VM
tools, golden image, build script and control.py/phases.py are in
/tmp/obscura-vm-validation from the previous run. Use a new evidence directory
and private writable overlay; never overwrite the recorded failing PCAP. Build
with one Cargo job because this host has limited RAM. Install only in the VM.

## Validation and Acceptance

Unit tests must distinguish absent/disabled flags from invalid data and read the
same serialized shape as production Config. Kernel tests must see EPERM for
unmarked IPv4/IPv6 probes before any subsequent network configuration call, while
marked control traffic succeeds. A VM boot with an enabled flag must capture zero
unmarked DNS/UDP/TCP packets on physical NICs; its positive disabled baseline must
capture those packets. Service logs must place blocking acknowledgement before
network availability. Existing crash, reconnect and suspend scenarios must retain
zero observed leaks and recover a usable VPN connection.

## Idempotence and Recovery

Use a fresh VM overlay and config; preserve the user's working-tree changes and
host service. A failed test must retain its JSON/PCAP, not be classified as passed.
Restore injected network faults, disconnect/logout the guest, shut down QEMU and
remove the guest overlay containing test keys. Keep public tools and evidence.

## Artifacts and Notes

The pre-fix PCAP is /tmp/obscura-vm-validation/boot.pcap; its 93 unmarked packets
precede the first firewall acknowledgement at 5.749 seconds after kernel startup.
New evidence and final commands will be added after verification.

## Interfaces and Dependencies

Use std::fs, serde_json, tokio and the existing NftTable/TrafficPolicy; add no
dependencies or external nft command to production startup. The constructor
becomes LinuxOsImpl::new(dns_manager_arg, config_dir: &Path). Share the existing
TUN name constant within the Linux module to create rules before the device exists.

## Outcomes & Retrospective

The reproduced startup escape is corrected. 18 unit tests, 3 kernel tests, two enabled VM boots, a disabled positive control, and real-VPN lifecycle/config-recovery checks passed. Evidence and scope are in KILL_SWITCH_BOOT_FIX_REPORT.md. The guest was logged out and shut down, its writable disk removed, and the temporary HTTP server stopped. The host service remained unchanged.

Initial plan: 2026-09-04. Scope is the confirmed boot leak and its regressions.

Verification update: strict config/default tests and the new kernel boot test passed; systemd-analyze verify found no unit dependency issue. VM packaging and lifecycle verification remain pending.

VM update: the corrected package hash is 23186320c69b3de7d3afe8da840fce6e70e269523917cffe8eee166db81cf5df, with installed service binary 5460e86d81b9ad34070087253da31bbf5ca933da36f0de7ef1ba2e2d058c43e8. First enabled boot captured zero leaks and 494 control packets; further controls and lifecycle regressions are running in /tmp/obscura-boot-fix.

Final verification update: /tmp/obscura-boot-fix/lifecycle-result.json records all eight VM scenarios passing. Enabled boots captured 0 leaks with 494/504 controls; disabled boot captured 738 expected packets. Recovery polling was adjusted to tolerate the interval before the service recreates its IPC socket, then rerun successfully.
