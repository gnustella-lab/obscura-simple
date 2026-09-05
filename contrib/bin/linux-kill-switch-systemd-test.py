#!/usr/bin/env python3
"""Exercise the real service under a transient user systemd unit in private namespaces."""
import collections
import errno
import hashlib
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
import tempfile
import time


def run(*args, **kwargs):
    completed = subprocess.run(args, text=True, capture_output=True, timeout=30, **kwargs)
    if completed.returncode:
        raise RuntimeError(f'{args}: {completed.stderr or completed.stdout}')
    return completed.stdout


def ipc_status():
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(2)
        client.connect('/run/obscura.sock')
        def read_exact(size):
            data = b''
            while len(data) < size:
                chunk = client.recv(size - len(data))
                if not chunk:
                    raise EOFError('IPC closed')
                data += chunk
            return data
        read_exact(struct.unpack('!I', read_exact(4))[0])
        command = b'{"getStatus":{"knownVersion":null}}'
        client.sendall(struct.pack('!I', len(command)) + command)
        response = b''
        while chunk := client.recv(65536):
            response += chunk
        return json.loads(response)['Ok']


def probe(directory, baseline=False):
    directory = Path(directory)
    counters = collections.Counter()
    phases = collections.Counter()
    sockets = []
    capture = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(3))
    capture.bind(('ks-test', 0))
    capture.setblocking(False)
    for family, address in [(socket.AF_INET, '198.18.0.2'), (socket.AF_INET6, '2001:db8::2')]:
        for port in [53, 443]:
            for marked in [False, True]:
                udp = socket.socket(family, socket.SOCK_DGRAM)
                udp.setsockopt(socket.SOL_SOCKET, socket.SO_BINDTODEVICE, b'ks-test\0')
                if marked:
                    udp.setsockopt(socket.SOL_SOCKET, socket.SO_MARK, 0x6f627363)
                udp.connect((address, port))
                sockets.append((udp, marked, f'{family.name}:{port}'))
    start = time.monotonic()
    (directory / 'probe-ready').touch()
    while not (directory / 'probe-stop').exists():
        phase = (directory / 'phase').read_text()
        phases[phase] += 1
        for udp, marked, label in sockets:
            try:
                udp.send(b'ks-allowed' if marked else b'ks-blocked')
                result = 'allowed' if marked else 'unblocked'
            except OSError as error:
                result = 'blocked' if not marked and error.errno == errno.EPERM else f'error-{error.errno}'
            counters[f'{label}:{result}'] += 1
        for family, address in [(socket.AF_INET, '198.18.0.2'), (socket.AF_INET6, '2001:db8::2')]:
            with socket.socket(family, socket.SOCK_STREAM) as tcp:
                tcp.setsockopt(socket.SOL_SOCKET, socket.SO_BINDTODEVICE, b'ks-test\0')
                tcp.setblocking(False)
                result = tcp.connect_ex((address, 80))
                counters[f'{family.name}:TCP:{result}'] += 1
        while True:
            try:
                packet = capture.recv(65536)
            except BlockingIOError:
                break
            if b'ks-blocked' in packet:
                counters['captured-unblocked-udp'] += 1
            if b'ks-allowed' in packet:
                counters['captured-control-udp'] += 1
            if len(packet) < 54:
                continue
            protocol = packet[12:14]
            if protocol == b'\x08\x00' and packet[23] == socket.IPPROTO_TCP:
                family, offset = 'AF_INET', 14 + (packet[14] & 15) * 4
            elif protocol == b'\x86\xdd' and packet[20] == socket.IPPROTO_TCP:
                family, offset = 'AF_INET6', 54
            else:
                continue
            if len(packet) >= offset + 20 and packet[offset + 2:offset + 4] == b'\x00\x50' and packet[offset + 13] & 2:
                counters[f'{family}:captured-syn'] += 1
        time.sleep(0.002)
        if baseline and time.monotonic() - start > 0.5:
            break
    result = dict(seconds=time.monotonic() - start, phases=dict(phases), counters=dict(counters))
    (directory / ('baseline.json' if baseline else 'traffic.json')).write_text(json.dumps(result, indent=2))
    for udp, _, _ in sockets:
        udp.close()
    capture.close()


def wait_for(predicate, description, timeout=25):
    end = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < end:
        try:
            value = predicate()
            if value:
                return value
        except (subprocess.SubprocessError, OSError, ValueError, KeyError, RuntimeError) as error:
            last_error = error
        time.sleep(0.1)
    raise RuntimeError(f'Timed out: {description}; last error: {last_error}')


def main(binary):
    binary = Path(binary).resolve(strict=True)
    script = Path(__file__).resolve()
    directory = Path(tempfile.mkdtemp(prefix='obscura-systemd-test-'))
    unit = f'obscura-ks-test-{os.getpid()}.service'
    print(f'Evidence: {directory}', flush=True)
    for name in ['config', 'logs', 'runtime', 'run-user']:
        (directory / name).mkdir()
    (directory / 'config/config.json').write_text(json.dumps({
        'feature_flags': {'killSwitch': True}, 'local_network_access': 'Disabled',
    }))
    (directory / 'phase').write_text('baseline')
    setup = '''
set -eu
mount --make-rprivate /
mount --rbind /run/user "$1/run-user"
mount -t tmpfs tmpfs /run
mkdir /run/user
mount --rbind "$1/run-user" /run/user
ip link set lo up
ip link add ks-test type dummy
ip link set ks-test up
ip addr add 198.18.0.1/24 dev ks-test
ip -6 addr add 2001:db8::1/64 dev ks-test nodad
ip neigh add 198.18.0.2 lladdr 02:00:00:00:00:02 nud permanent dev ks-test
ip -6 neigh add 2001:db8::2 lladdr 02:00:00:00:00:02 nud permanent dev ks-test
touch "$1/namespace-ready"
exec sleep infinity
'''
    keeper = subprocess.Popen(['unshare', '--user', '--map-root-user', '--net', '--mount', 'bash', '-c', setup, 'bash', str(directory)])
    monitor = None
    started = False
    result = {'passed': False, 'unit': unit, 'binary_sha256': hashlib.file_digest(binary.open('rb'), 'sha256').hexdigest(), 'events': []}
    def ns(*args):
        return ['nsenter', '--target', str(keeper.pid), '--user', '--net', '--mount', '--preserve-credentials', *map(str, args)]
    def properties():
        data = run('systemctl', '--user', 'show', unit, '-p', 'MainPID', '-p', 'NRestarts', '-p', 'NFileDescriptorStore', '-p', 'ActiveState')
        return dict(line.split('=', 1) for line in data.splitlines())
    def healthy():
        status = json.loads(run(*ns(sys.executable, script, '--status')))
        return status.get('firewallStatus') == 'blocking' and status.get('featureFlags', {}).get('killSwitch') is True
    try:
        wait_for(lambda: (directory / 'namespace-ready').exists(), 'namespace setup')
        run(*ns(sys.executable, script, '--baseline', directory))
        baseline = json.loads((directory / 'baseline.json').read_text())['counters']
        assert baseline.get('captured-unblocked-udp', 0) > 0, baseline
        for family in ['AF_INET', 'AF_INET6']:
            for port in [53, 443]:
                assert baseline.get(f'{family}:{port}:unblocked', 0) > 0, baseline
            assert baseline.get(f'{family}:TCP:{errno.EINPROGRESS}', 0) > 0, baseline
            assert baseline.get(f'{family}:captured-syn', 0) > 0, baseline
        (directory / 'probe-ready').unlink()
        run('systemd-run', '--user', f'--unit={unit}', '--property=Type=notify', '--property=NotifyAccess=main',
            '--property=FileDescriptorStoreMax=8', '--property=Restart=always', '--property=RestartSec=1',
            '--property=StartLimitIntervalSec=0', '--property=TimeoutStartSec=30', '--property=TimeoutStopSec=5',
            '--setenv=DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/missing-test-dbus', '--setenv=RUST_LOG=info',
            *ns(binary, 'service', '--config-dir', directory / 'config', '--log-dir', directory / 'logs',
                '--runtime-dir', directory / 'runtime', '--dns', 'disabled'))
        started = True
        wait_for(healthy, 'initial blocking state')
        assert int(properties()['NFileDescriptorStore']) >= 1, properties()
        (directory / 'phase').write_text('protected')
        monitor = subprocess.Popen(ns(sys.executable, script, '--probe', directory))
        wait_for(lambda: (directory / 'probe-ready').exists(), 'traffic monitor')
        time.sleep(0.2)
        for action in ['crash', 'restart'] * 3:
            before = properties()
            (directory / 'phase').write_text(action)
            if action == 'crash':
                run('systemctl', '--user', 'kill', '--kill-whom=main', '--signal=SIGKILL', unit)
            else:
                run('systemctl', '--user', 'restart', unit)
            wait_for(lambda: properties()['MainPID'] not in ['0', before['MainPID']], f'{action}: new PID')
            wait_for(healthy, f'{action}: blocking restored')
            after = properties()
            assert int(after['NFileDescriptorStore']) >= 1, after
            if action == 'crash':
                assert int(after['NRestarts']) > int(before['NRestarts']), (before, after)
            result['events'].append({'action': action, 'before': before, 'after': after})
            print(f'{action}: {before["MainPID"]} -> {after["MainPID"]}, FD store={after["NFileDescriptorStore"]}', flush=True)
            time.sleep(0.2)
        (directory / 'probe-stop').touch()
        assert monitor.wait(timeout=10) == 0
        traffic = json.loads((directory / 'traffic.json').read_text())
        counters = traffic['counters']
        assert counters.get('captured-unblocked-udp', 0) == 0, counters
        assert counters.get('captured-control-udp', 0) > 0, counters
        for family in ['AF_INET', 'AF_INET6']:
            for port in [53, 443]:
                assert counters.get(f'{family}:{port}:blocked', 0) > 0, counters
                assert counters.get(f'{family}:{port}:allowed', 0) > 0, counters
                assert counters.get(f'{family}:{port}:unblocked', 0) == 0, counters
            assert counters.get(f'{family}:captured-syn', 0) == 0, counters
            assert sum(value for key, value in counters.items() if key.startswith(f'{family}:TCP:')) > 0, counters
        assert not any('error-' in key for key in counters), counters
        assert all(traffic['phases'].get(phase, 0) > 0 for phase in ['protected', 'crash', 'restart']), traffic
        result['traffic'] = traffic
    finally:
        (directory / 'probe-stop').touch()
        if monitor is not None and monitor.poll() is None:
            monitor.wait(timeout=10)
        if started:
            journal = run('journalctl', '--user', '-u', unit, '--no-pager', '-o', 'short-precise')
            (directory / 'journal.txt').write_text(journal)
            result['adoptions'] = journal.count('adopting stored nftables socket')
            result['passed'] = 'traffic' in result and result['adoptions'] >= len(result['events'])
            run('systemctl', '--user', 'stop', unit)
            subprocess.run(['systemctl', '--user', 'reset-failed', unit], capture_output=True)
        keeper.terminate()
        keeper.wait(timeout=10)
        (directory / 'result.json').write_text(json.dumps(result, indent=2))
    assert result['passed'], result
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    if sys.argv[1] == '--status':
        print(json.dumps(ipc_status()))
    elif sys.argv[1] in ['--probe', '--baseline']:
        probe(sys.argv[2], baseline=sys.argv[1] == '--baseline')
    else:
        main(sys.argv[1])
