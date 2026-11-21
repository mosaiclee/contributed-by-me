"""Build the unsigned RhythmDesk 1.60 APK from the signed 1.59 APK.

Usage: python3 repack_apk.py OLD.apk NEW_INDEX_HTML OUT_UNSIGNED.apk

Replaces assets/index.html, raises versionCode 159 -> 160 and versionName 1.59 -> 1.60 in the binary
manifest, keeps every other entry byte-for-byte, and 4-byte aligns stored entries (resources.arsc).
The old APK Signing Block is dropped; sign the result with sign_apk.java.
"""
import struct
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from axml import read  # noqa: E402

old_apk, page, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
source = zipfile.ZipFile(old_apk)

manifest = bytearray(source.read('AndroidManifest.xml'))
_, elements = read(bytes(manifest))
attrs = {name: (kind, value, offset) for tag, items in elements if tag == 'manifest'
         for name, kind, value, _, offset in items}
kind, code, offset = attrs['versionCode']
assert kind == 0x10 and code == 159, attrs['versionCode']
struct.pack_into('<I', manifest, offset, 160)
for encoded in ('1.59'.encode('utf-16le'), b'\x04\x041.59\x00'):
    if bytes(manifest).count(encoded) == 1:
        start = bytes(manifest).index(encoded)
        manifest[start:start + len(encoded)] = encoded.replace(b'1\x00.\x005\x009', b'1\x00.\x006\x000').replace(b'1.59', b'1.60')
        break
else:
    raise SystemExit('versionName 1.59 not found exactly once')
_, elements = read(bytes(manifest))
check = {name: (value, raw) for tag, items in elements if tag == 'manifest' for name, _, value, raw, _ in items}
assert check['versionCode'][0] == 160 and check['versionName'][1] == '1.60', check

replacements = {'AndroidManifest.xml': bytes(manifest), 'assets/index.html': page.read_bytes()}
with zipfile.ZipFile(out, 'w') as target:
    for info in source.infolist():
        data = replacements.get(info.filename, None)
        if data is None:
            data = source.read(info.filename)
        entry = zipfile.ZipInfo(info.filename, info.date_time)
        entry.compress_type = info.compress_type
        entry.create_system = info.create_system
        entry.external_attr = info.external_attr
        if info.compress_type == zipfile.ZIP_STORED:
            # Local header is 30 bytes + name + extra; pad the extra so the data starts on a 4-byte boundary.
            header = target.fp.tell() + 30 + len(entry.filename.encode())
            entry.extra = b'\0' * ((4 - header % 4) % 4)
        target.writestr(entry, data, compress_type=info.compress_type, compresslevel=9)

with zipfile.ZipFile(out) as result:
    assert result.testzip() is None
    for info in result.infolist():
        if info.compress_type == zipfile.ZIP_STORED:
            start = info.header_offset + 30 + len(info.filename.encode()) + len(info.extra)
            assert start % 4 == 0, info.filename
    assert result.read('assets/index.html') == page.read_bytes()
print(f'Unsigned APK written: {out} ({out.stat().st_size} bytes), versionCode 160, versionName 1.60')
