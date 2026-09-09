#!/usr/bin/env python3
"""Read-only package coexistence checks. Pass a real built .deb as argument."""
import pathlib
import subprocess
import sys
import tarfile
import io

package = pathlib.Path(sys.argv[1]).resolve()

def run(*args):
    return subprocess.check_output(args)

payload = tarfile.open(fileobj=io.BytesIO(run('dpkg-deb', '--fsys-tarfile', str(package))))
files = {('/' + m.name.removeprefix('./')): m for m in payload if m.isfile() or m.issym()}
required = {
    '/usr/bin/obscura-simple', '/usr/bin/obscura-simple-gui',
    '/usr/lib/systemd/system/obscura-simple.service',
    '/usr/lib/sysusers.d/obscura-simple.conf',
    '/etc/apparmor.d/obscura-simple-gui',
    '/usr/share/applications/io.github.gnustella_lab.obscura_simple.desktop',
}
assert required <= files.keys(), required - files.keys()
assert all(m.uid == 0 and m.gid == 0 for m in files.values())
# Query ownership only, never install or modify either package.
for official in ('obscura', 'obscura-cli', 'obscura-gui', 'obscura-repository'):
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
print('PASS: real package has isolated files, service state, desktop identity, IPC and safe installation scripts')
