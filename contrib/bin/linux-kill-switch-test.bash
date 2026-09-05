#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
mode=${1:-full}
if [[ "$mode" != full && "$mode" != --firewall-only ]]; then
  echo 'Usage: bash contrib/bin/linux-kill-switch-test.bash [--firewall-only]' >&2
  exit 2
fi
build_log=$(mktemp)
trap 'rm -f "$build_log"' EXIT
cargo test --manifest-path rustlib/Cargo.toml --bin obscura --no-default-features --offline --no-run --message-format=json > "$build_log"
test_binary=$(python3 - "$build_log" <<'PY'
import json, sys
for line in open(sys.argv[1]):
    message = json.loads(line)
    if message.get('reason') == 'compiler-artifact' and message.get('profile', {}).get('test') and message.get('executable'):
        print(message['executable'])
PY
)
run_test() {
  unshare --user --map-root-user --net --mount bash -eu -c '
    mount --make-rprivate /
    mount -t tmpfs tmpfs /run
    export OBSCURA_TEST_NETNS=1
    export DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/missing-test-dbus
    unset NOTIFY_SOCKET LISTEN_FDS LISTEN_PID LISTEN_FDNAMES
    exec timeout 60 "$1" "$2" --ignored --test-threads=1 --nocapture
  ' bash "$test_binary" "$1"
}
run_test kill_switch_kernel
if [[ "$mode" == full ]]; then
  if [[ ! -c /dev/net/tun ]]; then
    echo 'Firewall tests passed; full DNS/service test requires /dev/net/tun and has NOT run.' >&2
    exit 1
  fi
  run_test kill_switch_dns_failure
  run_test kill_switch_boot
fi
