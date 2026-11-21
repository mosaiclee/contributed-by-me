"""Minimal Android binary XML reader: prints elements with attributes and the file offsets of their values."""
import struct, sys, zipfile
def strings(data, off):
    _, hsize, size, count, scount, flags, sstart, _ = struct.unpack_from('<HHIIIIII', data, off)
    utf8 = flags & 0x100
    offs = struct.unpack_from('<%dI' % count, data, off + hsize)
    out = []
    for o in offs:
        p = off + sstart + o
        if utf8:
            n = data[p]; p += 2 if n & 0x80 else 1
            n = data[p]; 
            if n & 0x80: n = ((n & 0x7f) << 8) | data[p+1]; p += 2
            else: p += 1
            out.append(data[p:p+n].decode('utf-8'))
        else:
            n = struct.unpack_from('<H', data, p)[0]; p += 2
            out.append(data[p:p+2*n].decode('utf-16le'))
    return out
def read(data):
    pos = 8; pool = []; elems = []
    while pos < len(data):
        typ, hsize, size = struct.unpack_from('<HHI', data, pos)
        if typ == 0x0001: pool = strings(data, pos)
        elif typ == 0x0102:
            ns, name, astart, asize, acount = struct.unpack_from('<iiHHH', data, pos + 16)
            attrs = []
            for i in range(acount):
                a = pos + 16 + astart + i * asize
                ans, aname, raw, vsize, _, vtype, vdata = struct.unpack_from('<iiiHBBI', data, a)
                attrs.append((pool[aname], vtype, vdata, pool[raw] if raw >= 0 else None, a + 16))
            elems.append((pool[name], attrs))
        pos += size
    return pool, elems
if __name__ == '__main__':
    data = zipfile.ZipFile(sys.argv[1]).read('AndroidManifest.xml') if sys.argv[1].endswith('.apk') else open(sys.argv[1],'rb').read()
    pool, elems = read(data)
    for name, attrs in elems:
        print(name, [(n, hex(t), d, r, off) for n, t, d, r, off in attrs])
