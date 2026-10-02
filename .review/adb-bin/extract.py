import io, os, sys, tarfile, struct, hashlib, json

# Minimal ar parser (debian .deb = ar archive with data.tar.* member)
DEB_DIR = r'D:\emidost\.review\adb-bin\debs'
OUT_DIR = r'D:\emidost\.review\adb-bin\extracted'
os.makedirs(OUT_DIR, exist_ok=True)

def parse_ar(data: bytes):
    if data[:8] != b'!<arch>\n':
        raise ValueError('not an ar archive')
    pos = 8
    members = {}
    while pos < len(data):
        if pos + 60 > len(data):
            break
        hdr = data[pos:pos+60]
        name = hdr[0:16].decode('ascii', 'replace').strip()
        size = int(hdr[48:58].decode('ascii').strip() or 0)
        body = data[pos+60:pos+60+size]
        members[name.strip('/').strip()] = body
        pos += 60 + size + (size % 2)
    return members

def extract_deb(path: str):
    with open(path, 'rb') as f:
        data = f.read()
    members = parse_ar(data)
    for name, body in members.items():
        if name.startswith('data.tar'):
            mode = 'r:xz' if name.endswith('.xz') else 'r:gz' if name.endswith('.gz') else 'r:'
            try:
                tf = tarfile.open(fileobj=io.BytesIO(body), mode=mode)
            except tarfile.ReadError:
                continue
            for m in tf.getmembers():
                base = m.name.split('/')[-1]
                if base in ('adb', 'fastboot') or base.endswith('.so') or '.so.' in base:
                    dest = os.path.join(OUT_DIR, os.path.basename(path).replace('.deb', ''), base)
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    with tf.extractfile(m) as src, open(dest, 'wb') as out:
                        out.write(src.read())
            tf.close()

for f in sorted(os.listdir(DEB_DIR)):
    if f.endswith('.deb'):
        try:
            extract_deb(os.path.join(DEB_DIR, f))
            print('extracted', f)
        except Exception as e:
            print('FAIL', f, e)

# ELF DT_NEEDED of adb
def elf_needed(path: str):
    with open(path, 'rb') as f:
        d = f.read()
    if d[:4] != b'\x7fELF' or d[4] != 2:
        return ['<not elf64>']
    e_phoff = struct.unpack('<Q', d[32:40])[0]
    e_phentsize = struct.unpack('<H', d[54:56])[0]
    e_phnum = struct.unpack('<H', d[56:58])[0]
    dynamic = None
    strtab = None
    for i in range(e_phnum):
        off = e_phoff + i * e_phentsize
        p_type = struct.unpack('<I', d[off:off+4])[0]
        if p_type == 2:  # PT_DYNAMIC
            dynamic = struct.unpack('<Q', d[off+16:off+24])[0]
        if p_type == 3:  # PT_INTERP (irrelevant)
            pass
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
        if tag == 1:  # DT_NEEDED
            needed_offs.append(val)
        if tag == 5:  # DT_STRTAB
            strtab = val
        i += 1
    if strtab is None:
        return ['<no strtab>']
    names = []
    for off in needed_offs:
        end = d.index(b'\x00', strtab + off)
        names.append(d[strtab+off:end].decode())
    return names

adb_path = os.path.join(OUT_DIR, 'android-tools_37.0.0-2_aarch64.deb', 'adb')
print('adb size:', os.path.getsize(adb_path))
print('DT_NEEDED:', elf_needed(adb_path))
print('sha256(adb):', hashlib.sha256(open(adb_path,'rb').read()).hexdigest())
