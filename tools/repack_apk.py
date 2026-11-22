"""Build an unsigned RhythmDesk APK from the previous signed release.

Usage: python3 repack_apk.py OLD.apk NEW_INDEX_HTML OUT_UNSIGNED.apk NEW_VERSION
       (for example NEW_VERSION 1.61 -> versionName "1.61", versionCode 161)

Replaces assets/index.html, sets versionCode/versionName in the binary manifest (the old name must
have the same length, e.g. 1.60 -> 1.61), keeps every other entry's content, and 4-byte aligns stored
entries (resources.arsc). The old APK Signing Block is dropped; sign the result with SignApk.java.
"""
import struct
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from axml import read  # noqa: E402

old_apk, page, out, version = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4]
code = int(version.replace('.', ''))
source = zipfile.ZipFile(old_apk)

manifest = bytearray(source.read('AndroidManifest.xml'))
_, elements = read(bytes(manifest))
attrs = {name: (kind, value, raw, offset) for tag, items in elements if tag == 'manifest'
         for name, kind, value, raw, offset in items}
kind, old_code, _, offset = attrs['versionCode']
old_name = attrs['versionName'][2]
assert kind == 0x10 and old_code < code, attrs['versionCode']
assert len(old_name) == len(version), (old_name, version)
struct.pack_into('<I', manifest, offset, code)
for old, new in ((old_name.encode('utf-16le'), version.encode('utf-16le')),
                 (bytes([len(old_name)] * 2) + old_name.encode() + b'\0', bytes([len(version)] * 2) + version.encode() + b'\0')):
    if bytes(manifest).count(old) == 1:
        start = bytes(manifest).index(old)
        manifest[start:start + len(old)] = new
        break
else:
    raise SystemExit(f'versionName {old_name} not found exactly once')
_, elements = read(bytes(manifest))
check = {name: (value, raw) for tag, items in elements if tag == 'manifest' for name, _, value, raw, _ in items}
assert check['versionCode'][0] == code and check['versionName'][1] == version, check

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
    raw = out.read_bytes()
    for info in result.infolist():
        if info.compress_type == zipfile.ZIP_STORED:
            name_len, extra_len = struct.unpack_from('<HH', raw, info.header_offset + 26)
            assert (info.header_offset + 30 + name_len + extra_len) % 4 == 0, info.filename
    assert result.read('assets/index.html') == page.read_bytes()
print(f'Unsigned APK written: {out} ({out.stat().st_size} bytes), versionCode {old_code} -> {code}, '
      f'versionName {old_name} -> {version}')
