#!/usr/bin/env bash
set -euo pipefail

# Exercise dpkg's unpack/configure path in a temporary root. The maintainer
# scripts are run with harmless command stubs, so this never starts systemd,
# loads AppArmor or changes the host. Pass a second package to exercise an
# actual version upgrade; without it the transaction is repeated as an
# idempotent reinstall check.
PACKAGE="${1:?usage: $0 PACKAGE.deb [PREVIOUS.deb]}"
PREVIOUS="${2:-}"
ROOT="$(mktemp -d -t obscura-simple-dpkg.XXXXXXXX)"
trap 'rm -rf "$ROOT"' EXIT

mkdir -p "$ROOT/var/lib/dpkg" "$ROOT/bin" "$ROOT/usr/bin" "$ROOT/usr/sbin" "$ROOT/etc" "$ROOT/dev"
: > "$ROOT/dev/null"
: > "$ROOT/var/lib/dpkg/status"

# A dynamically linked shell needs its loader and libraries inside the chroot.
install -Dm755 "$(readlink -f /bin/sh)" "$ROOT/bin/sh"
while read -r dependency; do
  [ -e "$dependency" ] || continue
  install -D "$dependency" "$ROOT$dependency"
done < <(ldd /bin/sh | awk '$1 ~ /^\// { print $1 } $3 ~ /^\// { print $3 }')

for command_path in "$ROOT/usr/bin/systemd-sysusers" "$ROOT/usr/bin/systemctl" "$ROOT/usr/sbin/apparmor_parser"; do
  printf '%s\n' '#!/bin/sh' 'exit 0' > "$command_path"
  chmod 755 "$command_path"
done
export PATH="$ROOT/usr/bin:$ROOT/usr/sbin:$ROOT/bin:$PATH"

dpkg_args=(--root="$ROOT" --force-depends)
if [ -n "$PREVIOUS" ]; then
  dpkg "${dpkg_args[@]}" --unpack "$PREVIOUS"
  dpkg "${dpkg_args[@]}" --configure obscura-simple
fi
dpkg "${dpkg_args[@]}" --unpack "$PACKAGE"
dpkg "${dpkg_args[@]}" --configure obscura-simple

if [ -n "$PREVIOUS" ]; then
  printf 'PASS: isolated install and upgrade completed for %s\n' "$PACKAGE"
else
  dpkg "${dpkg_args[@]}" --unpack "$PACKAGE"
  dpkg "${dpkg_args[@]}" --configure obscura-simple
  printf 'PASS: isolated install and idempotent reinstall completed for %s\n' "$PACKAGE"
fi
