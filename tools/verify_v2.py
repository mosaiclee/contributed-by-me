"""Independent APK Signature Scheme v2 check: content digests, RSA signature and signer certificate."""
import hashlib, struct, sys, zipfile
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
data = open(sys.argv[1], 'rb').read()
eocd = data.rfind(b'PK\x05\x06'); cd = struct.unpack_from('<I', data, eocd + 16)[0]
assert data[cd-16:cd] == b'APK Sig Block 42'
size = struct.unpack_from('<Q', data, cd - 24)[0]; start = cd - size - 8
assert struct.unpack_from('<Q', data, start)[0] == size
def lp(b, p): n = struct.unpack_from('<I', b, p)[0]; return b[p+4:p+4+n], p+4+n
def seq(b):
    p, out = 0, []
    while p < len(b): item, p = lp(b, p); out.append(item)
    return out
pos, v2 = start + 8, None
while pos < cd - 24:
    n, ident = struct.unpack_from('<QI', data, pos)
    if ident == 0x7109871a: v2 = data[pos+12:pos+8+n]
    pos += 8 + n
signer = seq(lp(v2, 0)[0])[0]
signed, p = lp(signer, 0); sigs, p = lp(signer, p); pub, p = lp(signer, p)
digests, q = lp(signed, 0); certs, q = lp(signed, q)
cert = x509.load_der_x509_certificate(seq(certs)[0])
for s in seq(sigs):
    algo = struct.unpack_from('<I', s, 0)[0]; sig = lp(s, 4)[0]
    assert algo in (0x0103, 0x0104), hex(algo)  # RSASSA-PKCS1-v1_5 with SHA2-256 / SHA2-512
    cert.public_key().verify(sig, signed, padding.PKCS1v15(), hashes.SHA256() if algo == 0x0103 else hashes.SHA512())
for d in seq(digests):
    algo = struct.unpack_from('<I', d, 0)[0]; expected = lp(d, 4)[0]
    h = hashlib.sha256 if algo == 0x0103 else hashlib.sha512
    eocd_bytes = bytearray(data[eocd:]); struct.pack_into('<I', eocd_bytes, 16, start)
    chunks = []
    for section in (data[:start], data[cd:eocd], bytes(eocd_bytes)):
        for i in range(0, len(section), 1 << 20):
            c = section[i:i + (1 << 20)]
            chunks.append(h(b'\xa5' + struct.pack('<I', len(c)) + c).digest())
    top = h(b'\x5a' + struct.pack('<I', len(chunks)) + b''.join(chunks)).digest()
    assert top == expected, 'content digest mismatch'
print('v2 OK: signature valid, content digest matches; signer', cert.subject.rfc4514_string(),
      'sha256', hashlib.sha256(seq(certs)[0]).hexdigest())
z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
for info in z.infolist():
    if info.compress_type == 0:
        name_len, extra_len = struct.unpack_from('<HH', data, info.header_offset + 26)
        assert (info.header_offset + 30 + name_len + extra_len) % 4 == 0, info.filename
print('zip OK:', len(z.infolist()), 'entries, stored entries 4-byte aligned')
