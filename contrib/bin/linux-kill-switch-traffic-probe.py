#!/usr/bin/env python3
"""Run only inside the disposable validation VM; capture probes on physical NICs."""
import argparse
import collections
import json
from pathlib import Path
import signal
import socket
import struct
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--seconds', type=float, default=300)
    args = parser.parse_args()
    if not Path('/var/tmp/obscura-vm-ready').exists():
        raise SystemExit('This probe is restricted to the prepared validation VM')
    output = Path(args.output)
    pcap = output.with_suffix('.pcap').open('wb')
    pcap.write(struct.pack('<IHHIIII', 0xa1b2c3d4, 2, 4, 0, 0, 65535, 1))
    counters = collections.Counter()
    errors = collections.Counter()
    leaks = []
    stopped = False
    def stop(*_):
        nonlocal stopped
        stopped = True
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    capture = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(3))
    capture.setblocking(False)
    senders = []
    for family, address in [(socket.AF_INET, '1.1.1.1'), (socket.AF_INET6, '2606:4700:4700::1111')]:
        for port in [53, 443]:
            for marked in [False, True]:
                udp = socket.socket(family, socket.SOCK_DGRAM)
                udp.setblocking(False)
                if marked:
                    udp.setsockopt(socket.SOL_SOCKET, socket.SO_MARK, 0x6f627363)
                if port == 53:
                    payload = struct.pack('!HHHHHH', 0x4b54 if marked else 0x4b53, 0x0100, 1, 0, 0, 0)
                    payload += b'\x07example\x03com\0\0\x01\0\x01'
                else:
                    payload = b'ks-control' if marked else b'ks-probe'
                senders.append((udp, (address, port), payload, marked, family.name))
    started = time.monotonic()
    last_saved = 0
    def save():
        data = dict(started_monotonic=started, seconds=time.monotonic()-started,
                    counters=dict(counters), errors=dict(errors), leaks=leaks)
        temporary = output.with_suffix('.tmp')
        temporary.write_text(json.dumps(data, indent=2))
        temporary.replace(output)
    try:
        while not stopped and time.monotonic() - started < args.seconds:
            for udp, destination, payload, marked, family in senders:
                label = f'{family}:UDP{destination[1]}:{"control" if marked else "probe"}'
                counters[label + ':attempted'] += 1
                try:
                    udp.sendto(payload, destination)
                    counters[label + ':sent'] += 1
                except OSError as error:
                    errors[label + f':errno{error.errno}'] += 1
            for family, address in [(socket.AF_INET, '1.1.1.1'), (socket.AF_INET6, '2606:4700:4700::1111')]:
                with socket.socket(family, socket.SOCK_STREAM) as tcp:
                    tcp.setblocking(False)
                    tcp.connect_ex((address, 443))
                    counters[f'{family.name}:TCP:attempted'] += 1
            while True:
                try:
                    packet, metadata = capture.recvfrom(65536)
                except BlockingIOError:
                    break
                interface, _, direction, *_ = metadata
                if direction != socket.PACKET_OUTGOING or interface not in ['ens2', 'ens3'] or len(packet) < 34:
                    continue
                ethernet = packet[12:14]
                if ethernet == b'\x08\x00':
                    family, offset, protocol = 'AF_INET', 14 + (packet[14] & 15)*4, packet[23]
                    destination = socket.inet_ntop(socket.AF_INET, packet[30:34])
                    if destination != '1.1.1.1':
                        continue
                elif ethernet == b'\x86\xdd':
                    if len(packet) < 54:
                        continue
                    family, offset, protocol = 'AF_INET6', 54, packet[20]
                    destination = socket.inet_ntop(socket.AF_INET6, packet[38:54])
                    if destination != '2606:4700:4700::1111':
                        continue
                else:
                    continue
                if len(packet) < offset + 8:
                    continue
                port = struct.unpack('!H', packet[offset+2:offset+4])[0]
                timestamp = time.time()
                seconds = int(timestamp)
                pcap.write(struct.pack('<IIII', seconds, int((timestamp-seconds)*1_000_000), len(packet), len(packet)))
                pcap.write(packet)
                if protocol == socket.IPPROTO_UDP and port in [53, 443]:
                    payload = packet[offset+8:]
                    if payload.startswith((b'ks-control', b'\x4b\x54')):
                        counters[f'{family}:UDP{port}:control-captured'] += 1
                        continue
                    if not payload.startswith((b'ks-probe', b'\x4b\x53')):
                        continue
                    kind = f'UDP{port}'
                elif protocol == socket.IPPROTO_TCP and len(packet) >= offset + 20 and port == 443 and packet[offset+13] & 2:
                    kind = 'TCP-SYN'
                else:
                    continue
                counters[f'{family}:{kind}:leaked'] += 1
                if len(leaks) < 100:
                    leaks.append(dict(monotonic=time.monotonic(), interface=interface, family=family, kind=kind))
            if time.monotonic() - last_saved > 1:
                save()
                last_saved = time.monotonic()
            time.sleep(.1)
    finally:
        save()
        for udp, *_ in senders:
            udp.close()
        capture.close()
        pcap.close()


if __name__ == '__main__':
    main()
