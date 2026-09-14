#!/usr/bin/env bash
set -euo pipefail

RPM_FILE="${1:?usage: $0 PACKAGE.rpm}"
rpm -qip "$RPM_FILE"
rpm -qlp "$RPM_FILE" | grep -Fx /usr/bin/obscura-simple
rpm -qlp "$RPM_FILE" | grep -Fx /usr/bin/obscura-simple-gui
rpm -qlp "$RPM_FILE" | grep -Fx /usr/lib/systemd/system/obscura-simple.service
rpm -qlp "$RPM_FILE" | grep -Fx /usr/share/applications/io.github.gnustella_lab.obscura_simple.desktop
rpm -qp --requires "$RPM_FILE"
rpm -qp --requires "$RPM_FILE" | grep -Fx polkit
rpm -qp --scripts "$RPM_FILE" | grep -q 'obscura-simple.service'
if rpm -qp --scripts "$RPM_FILE" | grep -Eq 'systemctl (start|restart|enable)'; then
  echo 'RPM gate failed: package scripts start/restart/enable a service' >&2
  exit 1
fi
echo "PASS: RPM metadata and payload gates for $RPM_FILE"
