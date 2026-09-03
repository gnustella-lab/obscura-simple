#!/usr/bin/env bash
set -eux
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if ! getent group obscura > /dev/null; then
  echo "Creating obscura group..."
  sudo groupadd --system obscura
fi
sudo mkdir -p /var/lib/obscura /var/log/obscura
sudo chgrp obscura /var/lib/obscura /var/log/obscura
sudo chmod 770 /var/lib/obscura /var/log/obscura
if ! id -nG "$USER" | grep -qw obscura; then
  if ! groups "$USER" | grep -qw obscura; then
    echo "Adding $USER to obscura group..."
    sudo usermod -aG obscura "$USER"
    echo "Run 'newgrp obscura' or logout/login to make it effective."
  else
    echo "Obscura group already in /etc/group but not effective in this shell. Use 'newgrp obscura' after starting the service." >&2
  fi
fi
# Clean stale sockets left when service dies without unlink (causes misleading PermissionDenied)
if [ -S /run/obscura.sock ] || [ -S /run/obscura-live-groups.sock ]; then
  if ! pgrep -f "obscura service" > /dev/null; then
    echo "Stale sockets found without running service, removing..." >&2
    sudo rm -f /run/obscura.sock /run/obscura-live-groups.sock
  fi
fi
exec sudo --preserve-env=RUST_LOG -u root -g obscura bash -c "umask 0007 && exec \"$SCRIPT_DIR/rustlib/target/debug/obscura\" service --config-dir /var/lib/obscura --log-dir /var/log/obscura"
