import os, struct, hashlib, shutil

EXTRACT = r'D:\emidost\.review\adb-bin\extracted'
VENDOR = r'D:\emidost\.review\adb-bin\vendor'
os.makedirs(os.path.join(VENDOR, 'lib'), exist_ok=True)

SYSTEM_LIBS = {'libc.so', 'libdl.so', 'libm.so', 'liblog.so', 'libandroid.so',
               'libnetd_client.so', 'libsync.so', 'libcutils.so', 'libutils.so',
               'libbase.so', 'libbinder.so', 'libprocessgroup.so', 'libcgrouprc.so',
               'libpackagelistparser.so', 'libcap.so', 'libmdnssd.so',
               'libcrypto.so', 'libssl.so', 'libz.so', 'ld-android.so'}

def elf_needed(path):
    d = open(path, 'rb').read()
    if d[:4] != b'\x7fELF' or d[4] != 2:
        return []
    e_phoff = struct.unpack('<Q', d[32:40])[0]
    e_phentsize = struct.unpack('<H', d[54:56])[0]
    e_phnum = struct.unpack('<H', d[56:58])[0]
    dynamic = strtab = None
    for i in range(e_phnum):
        off = e_phoff + i * e_phentsize
        if off + 56 > len(d):
            break
        p_type = struct.unpack('<I', d[off:off+4])[0]
        if p_type == 2:
            dynamic = struct.unpack('<Q', d[off+8:off+16])[0]
    if dynamic is None:
        return []
    needed_offs = []
    i = 0
    while True:
        ent = dynamic + i * 16
        if ent + 16 > len(d):
            break
        tag = struct.unpack('<q', d[ent:ent+8])[0]
        val = struct.unpack('<Q', d[ent+8:ent+16])[0]
        if tag == 0:
            break
        if tag == 1:
            needed_offs.append(val)
        if tag == 5:
            strtab = val
        i += 1
    if strtab is None:
        return []
    names = []
    for o in needed_offs:
        try:
            end = d.index(b'\x00', strtab + o)
            names.append(d[strtab+o:end].decode())
        except ValueError:
            pass
    return names

# index of all extracted .so files by basename
so_index = {}
for root, _, files in os.walk(EXTRACT):
    for f in files:
        if f.endswith('.so') or '.so.' in f:
            so_index.setdefault(f, os.path.join(root, f))

def resolve(lib, seen, missing):
    if lib in SYSTEM_LIBS or lib in seen:
        return
    seen.add(lib)
    path = so_index.get(lib)
    if path is None:
        missing.add(lib)
        return
    for dep in elf_needed(path):
        resolve(dep, seen, missing)

needed = set()
missing = set()
adb_path = os.path.join(r'D:\emidost\.review\adb-bin\real\bin', 'adb')
for dep in elf_needed(adb_path):
    resolve(dep, needed, missing)

print('resolved libs (%d):' % len(needed))
for lib in sorted(needed):
    print(' ', lib)

# copy adb + resolved libs to vendor
shutil.copy2(adb_path, os.path.join(VENDOR, 'adb'))
for lib in sorted(needed):
    shutil.copy2(so_index[lib], os.path.join(VENDOR, 'lib', lib))

print('missing (should be system-provided):', sorted(missing))
total = os.path.getsize(os.path.join(VENDOR, 'adb'))
for lib in sorted(needed):
    total += os.path.getsize(os.path.join(VENDOR, 'lib', lib))
print('vendor total bytes:', total)
print('sha256(adb):', hashlib.sha256(open(os.path.join(VENDOR, 'adb'), 'rb').read()).hexdigest())
for lib in sorted(needed):
    print('sha256(%s): %s' % (lib, hashlib.sha256(open(os.path.join(VENDOR, 'lib', lib), 'rb').read()).hexdigest()))
