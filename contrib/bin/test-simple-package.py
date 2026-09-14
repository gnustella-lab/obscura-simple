#!/usr/bin/env python3
"""Read-only checks for the single Simple .deb. Pass a real built .deb."""
import pathlib
import subprocess
import sys
import tarfile
import io
import shutil

package = pathlib.Path(sys.argv[1]).resolve()

def run(*args):
    return subprocess.check_output(args)

payload = tarfile.open(fileobj=io.BytesIO(run('dpkg-deb', '--fsys-tarfile', str(package))))
files = {('/' + m.name.removeprefix('./')): m for m in payload if m.isfile() or m.issym()}
assert run('dpkg-deb', '-f', str(package), 'Package').decode().strip() == 'obscura-simple'
assert run('dpkg-deb', '-f', str(package), 'Version').decode().strip() == '1.177-17'
assert run('dpkg-deb', '-f', str(package), 'Architecture').decode().strip() in {'amd64', 'arm64'}
depends = run('dpkg-deb', '-f', str(package), 'Depends').decode()
for dependency in ('policykit-1', 'libgtk-4-1', 'libadwaita-1-0', 'libwebkitgtk-6.0-4', 'libsoup-3.0-0', 'libtss2-tctildr0t64'):
    assert dependency in depends, dependency
required = {
    '/usr/bin/obscura-simple', '/usr/bin/obscura-simple-gui',
    '/usr/lib/systemd/system/obscura-simple.service',
    '/usr/lib/sysusers.d/obscura-simple.conf',
    '/etc/apparmor.d/obscura-simple-gui',
    '/usr/share/applications/io.github.gnustella_lab.obscura_simple.desktop',
}
assert required <= files.keys(), required - files.keys()
assert all(m.uid == 0 and m.gid == 0 for m in files.values())
# Query ownership only, never install or modify either package. A clean CI
# runner may not have the upstream packages installed, so absence is fine.
for official in ('obscura', 'obscura-cli', 'obscura-gui', 'obscura-repository'):
    if shutil.which('dpkg-query') is None:
        break
    status = subprocess.run(('dpkg-query', '-W', '-f=${db:Status-Abbrev}', official), capture_output=True, text=True)
    if status.returncode != 0 or not status.stdout.startswith('ii '):
        continue
    installed = set(run('dpkg-query', '-L', official).decode().splitlines())
    assert not files.keys() & installed, (official, files.keys() & installed)

def read_member(archive, member):
    stream = archive.extractfile(member)
    assert stream is not None, member.name
    return stream.read()

def text(path):
    return read_member(payload, files[path]).decode()

unit = text('/usr/lib/systemd/system/obscura-simple.service')
for setting in ('ExecStart=/usr/bin/obscura-simple service', 'Group=obscura-simple',
                'StateDirectory=obscura-simple', 'RuntimeDirectory=obscura-simple',
                'LogsDirectory=obscura-simple'):
    assert setting in unit, setting
assert 'obscura.service' not in unit, 'Must not stop the official service via Conflicts='
desktop = text('/usr/share/applications/io.github.gnustella_lab.obscura_simple.desktop')
assert 'Exec=obscura-simple-gui' in desktop
assert 'x-scheme-handler/obscuravpn' not in desktop
assert 'Name=Obscura Simple (Unofficial)' in desktop
assert not any(path.endswith('.flatpak') or path.startswith('/app/') for path in files)
for binary in ('/usr/bin/obscura-simple', '/usr/bin/obscura-simple-gui'):
    assert b'/run/obscura-simple.sock' in read_member(payload, files[binary])
controls = tarfile.open(fileobj=io.BytesIO(run('dpkg-deb', '--ctrl-tarfile', str(package))))
for name in ('postinst', 'prerm', 'postrm'):
    member = next(m for m in controls if m.name.removeprefix('./') == name)
    script = read_member(controls, member).decode()
    for line in script.splitlines():
        if line.lstrip().startswith('#'):
            continue
        assert 'systemctl stop obscura.service' not in line
        assert 'systemctl disable obscura.service' not in line
        if name == 'postinst':
            assert not any('systemctl ' + action in line for action in ('start ', 'restart ', 'enable ', 'preset '))
print('PASS: single .deb has CLI+GUI, isolated files, service state, desktop identity, IPC and safe installation scripts')
