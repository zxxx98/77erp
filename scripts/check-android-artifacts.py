"""CI only: verify architectures and version metadata in the actual release artifacts."""
import pathlib
import re
import struct
import subprocess
import sys
import zipfile


def check_native_libraries(path):
    with zipfile.ZipFile(path) as archive:
        libraries = [name for name in archive.namelist() if name.endswith(".so")]
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
