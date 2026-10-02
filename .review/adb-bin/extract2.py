import io, os, tarfile, struct, hashlib

def parse_ar(data: bytes):
    if data[:8] != b'!<arch>\n':
        raise ValueError('not ar')
    pos = 8
    members = {}
    while pos < len(data):
        if pos + 60 > len(data):
            break
        hdr = data[pos:pos+60]
        name = hdr[0:16].decode('ascii', 'replace').strip()
        size = int(hdr[48:58].decode('ascii').strip() or 0)
        members[name.strip('/').strip()] = data[pos+60:pos+60+size]
        pos += 60 + size + (size % 2)
    return members

DEB = r'D:\emidost\.review\adb-bin\debs\android-tools_37.0.0-2_aarch64.deb'
OUT = r'D:\emidost\.review\adb-bin\real'
os.makedirs(OUT, exist_ok=True)
data = open(DEB, 'rb').read()
members = parse_ar(data)
for name, body in members.items():
    if name.startswith('data.tar'):
        tf = tarfile.open(fileobj=io.BytesIO(body), mode='r:xz')
        for m in tf.getmembers():
            # keep every usr/bin/* and anything containing adb binary
            if m.name.endswith('/adb') or m.name.endswith('/fastboot') or (m.name.startswith('data/data/com.termux/files/usr/bin/') and m.isfile()):
                rel = m.name.replace('data/data/com.termux/files/usr/', '')
                dest = os.path.join(OUT, rel)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with tf.extractfile(m) as src, open(dest, 'wb') as o:
                    o.write(src.read())
                print('kept', m.name, m.size)
        tf.close()

def elf_needed(path: str):
    d = open(path, 'rb').read()
    if d[:4] != b'\x7fELF' or d[4] != 2:
        return ['<not elf64>']
    e_phoff = struct.unpack('<Q', d[32:40])[0]
    e_phentsize = struct.unpack('<H', d[54:56])[0]
    e_phnum = struct.unpack('<H', d[56:58])[0]
    dynamic = strtab = None
    for i in range(e_phnum):
        off = e_phoff + i * e_phentsize
        p_type = struct.unpack('<I', d[off:off+4])[0]
        if p_type == 2:
            dynamic = struct.unpack('<Q', d[off+16:off+24])[0]
    if dynamic is None:
        return ['<no dynamic>']
    needed_offs = []
    i = 0
    while True:
        ent = dynamic + i * 16
        tag = struct.unpack('<q', d[ent:ent+8])[0]
        val = struct.unpack('<Q', d[ent+8:ent+16])[0]
        if tag == 0:
            break
        if tag == 1:
            needed_offs.append(val)
        if tag == 5:
            strtab = val
        i += 1
    names = []
    for off in needed_offs:
        end = d.index(b'\x00', strtab + off)
        names.append(d[strtab+off:end].decode())
    return names

adb = os.path.join(OUT, 'bin', 'adb')
print('real adb size:', os.path.getsize(adb))
print('DT_NEEDED:', elf_needed(adb))
print('sha256(adb):', hashlib.sha256(open(adb, 'rb').read()).hexdigest())
