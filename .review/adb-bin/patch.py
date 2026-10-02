import os, struct, hashlib

VENDOR = r'D:\emidost\.review\adb-bin\vendor'

def dyn_strtab_offset(path):
    d = open(path, 'rb').read()
    e_phoff = struct.unpack('<Q', d[32:40])[0]
    entsz = struct.unpack('<H', d[54:56])[0]
    phnum = struct.unpack('<H', d[56:58])[0]
    dynamic = None
    for i in range(phnum):
        off = e_phoff + i * entsz
        if off + 56 > len(d):
            break
        if struct.unpack('<I', d[off:off+4])[0] == 2:
            dynamic = struct.unpack('<Q', d[off+8:off+16])[0]
    if dynamic is None:
        return None, None
    strtab = None
    i = 0
    while True:
        ent = dynamic + i * 16
        if ent + 16 > len(d):
            break
        tag = struct.unpack('<q', d[ent:ent+8])[0]
        val = struct.unpack('<Q', d[ent+8:ent+16])[0]
        if tag == 5:
            strtab = val
        if tag == 0:
            break
        i += 1
    return dynamic, strtab

def find_runpath_vals(path):
    dynamic, strtab = dyn_strtab_offset(path)
    if dynamic is None or strtab is None:
        return None, None, None
    d = open(path, 'rb').read()
    vals = {}
    i = 0
    while True:
        ent = dynamic + i * 16
        if ent + 16 > len(d):
            break
        tag = struct.unpack('<q', d[ent:ent+8])[0]
        val = struct.unpack('<Q', d[ent+8:ent+16])[0]
        if tag == 0:
            break
        if tag in (15, 29):
            end = d.index(b'\x00', strtab + val)
            vals[tag] = (val, d[strtab+val:end].decode())
        i += 1
    return vals.get(29) or vals.get(15), strtab, len(d)

def patch_runpath(path, new):
    rp, strtab, size = find_runpath_vals(path)
    if rp is None:
        return False
    val, old = rp
    if new == old:
        return True
    if len(new) > len(old):
        raise ValueError('new longer than old: %s -> %s' % (old, new))
    d = bytearray(open(path, 'rb').read())
    pos = strtab + val
    d[pos:pos+len(new)] = new.encode()
    d[pos+len(new):pos+len(old)] = b'\x00' * (len(old) - len(new))
    open(path, 'wb').write(bytes(d))
    return True

# patch adb -> $ORIGIN/../lib ; libs -> $ORIGIN
adb = os.path.join(VENDOR, 'adb')
patch_runpath(adb, '$ORIGIN/../lib')
print('patched adb -> $ORIGIN/../lib')
libdir = os.path.join(VENDOR, 'lib')
count = 0
for f in sorted(os.listdir(libdir)):
    p = os.path.join(libdir, f)
    if patch_runpath(p, '$ORIGIN'):
        count += 1
print('patched libs -> $ORIGIN:', count)

# verify + final sha256s
def read_rp(path):
    rp, strtab, size = find_runpath_vals(path)
    if rp is None:
        return '<none>'
    d = open(path, 'rb').read()
    end = d.index(b'\x00', strtab + rp[0])
    return d[strtab+rp[0]:end].decode()

print('verify adb RUNPATH:', read_rp(adb))
bad = [f for f in os.listdir(libdir) if read_rp(os.path.join(libdir, f)) not in ('$ORIGIN', '<none>')]
print('libs with unexpected runpath:', bad)

lines = []
for f in ['adb'] + sorted(os.listdir(libdir)):
    p = os.path.join(VENDOR, f if f == 'adb' else os.path.join('lib', f))
    h = hashlib.sha256(open(p, 'rb').read()).hexdigest()
    lines.append('%s  %s' % (h, f))
open(os.path.join(VENDOR, 'SHA256SUMS'), 'w').write('\n'.join(lines) + '\n')
print('wrote SHA256SUMS, total', len(lines), 'entries')
