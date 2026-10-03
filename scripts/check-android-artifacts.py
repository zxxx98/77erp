"""CI only: verify architectures and version metadata in the actual release artifacts."""
import pathlib
import re
import struct
import subprocess
import sys
import zipfile


def dex_classes(data):
    """Read class definitions, not incidental strings, from a standard DEX file."""
    if data[:4] != b'dex\n':
        raise ValueError('Expected a standard DEX file')
    strings_count, strings_offset = struct.unpack_from('<II', data, 56)
    types_count, types_offset = struct.unpack_from('<II', data, 64)
    classes_count, classes_offset = struct.unpack_from('<II', data, 96)
    strings = []
    for index in range(strings_count):
        offset = struct.unpack_from('<I', data, strings_offset + 4 * index)[0]
        # Skip the ULEB128 UTF-16 length. Descriptors themselves are ASCII.
        while data[offset] & 0x80:
            offset += 1
        offset += 1
        strings.append(data[offset:data.index(b'\0', offset)].decode('utf-8', errors='replace'))
    types = [strings[struct.unpack_from('<I', data, types_offset + 4 * index)[0]]
             for index in range(types_count)]
    return {types[struct.unpack_from('<I', data, classes_offset + 32 * index)[0]]
            for index in range(classes_count)}


def check_jni_classes(archive):
    classes = set()
    for name in archive.namelist():
        if name.endswith('.dex'):
            classes.update(dex_classes(archive.read(name)))
    prefix = 'Lcom/facebook/react/devsupport/CxxInspectorPackagerConnection'
    for suffix in ['', '$DelegateImpl', '$WebSocketDelegate', '$IWebSocket']:
        if prefix + suffix + ';' not in classes:
            raise ValueError(f'R8 removed or renamed a JNI startup class: {prefix}{suffix};')


def check_native_libraries(path):
    with zipfile.ZipFile(path) as archive:
        check_jni_classes(archive)
        prefix = 'base/' if path.suffix == '.aab' else ''
        if prefix + 'assets/index.android.bundle' not in archive.namelist():
            raise ValueError(f"{path}: missing bundled React Native application")
        libraries = [name for name in archive.namelist() if name.endswith(".so")]
        for required in ['libhermes.so', 'libreactnative.so']:
            if prefix + 'lib/arm64-v8a/' + required not in libraries:
                raise ValueError(f"{path}: missing native runtime {required}")
        if not libraries:
            raise ValueError(f"{path}: APK/AAB has no native libraries; cannot enforce ARM64 installation")
        for name in libraries:
            if not re.fullmatch(r"(?:base/)?lib/arm64-v8a/[^/]+\.so", name):
                raise ValueError(f"{path}: unexpected native library {name}")
            header = archive.read(name)[:20]
            if header[:4] != b"\x7fELF" or header[4:6] != b"\x02\x01" or struct.unpack("<H", header[18:20])[0] != 183:
                raise ValueError(f"{path}: {name} is not an ARM64 ELF library")
        print(f"{path.name}: verified {len(libraries)} ARM64 libraries")


if __name__ == "__main__":
    apk, aab, aapt, version_name, version_code = sys.argv[1:]
    check_native_libraries(pathlib.Path(apk))
    check_native_libraries(pathlib.Path(aab))
    metadata = subprocess.check_output([aapt, "dump", "badging", apk], text=True)
    package = next(line for line in metadata.splitlines() if line.startswith("package:"))
    if f"versionName='{version_name}'" not in package or f"versionCode='{version_code}'" not in package:
        raise ValueError(f"APK version mismatch: {package}")
    if "name='com.erp77.app'" not in package or "native-code: 'arm64-v8a'" not in metadata:
        raise ValueError("Unexpected application ID or APK architecture")
    if not re.search(r"^sdkVersion:'31'$", metadata, re.MULTILINE):
        raise ValueError("APK must require Android 12 (API 31) or later")
    print(f"APK version verified: {version_name} ({version_code})")
    print("Minimum Android version verified: Android 12 (API 31)")
