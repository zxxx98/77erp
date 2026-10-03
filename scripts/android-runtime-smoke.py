"""Launch the published ARM64 binary on an Android image with ARM translation.

This is a runtime regression check, not a claim of physical ARM device coverage.
Unsupported images fail explicitly instead of substituting an x86 application.
"""
import pathlib
import subprocess
import sys
import time

apk_dir, report_dir = map(pathlib.Path, sys.argv[1:])
report_dir.mkdir(parents=True, exist_ok=True)
package = "com.erp77.app"


def adb(*args, check=True):
    return subprocess.run(["adb", *args], check=check, capture_output=True, text=True, timeout=45)


def capture():
    for name, args in {
        "logcat.txt": ["logcat", "-d", "-v", "threadtime"],
        "activity.txt": ["shell", "dumpsys", "activity", "activities"],
        "exit-info.txt": ["shell", "dumpsys", "activity", "exit-info", package],
    }.items():
        result = adb(*args, check=False)
        (report_dir / name).write_text(result.stdout + result.stderr)
    with (report_dir / "screen.png").open("wb") as image:
        subprocess.run(["adb", "exec-out", "screencap", "-p"], stdout=image, timeout=30, check=False)


try:
    props = adb("shell", "getprop").stdout
    (report_dir / "device-properties.txt").write_text(props)
    for line in props.splitlines():
        if any(key in line for key in ["abilist", "native.bridge", "version.sdk", "build.fingerprint"]):
            print(line, flush=True)
    apks = list(apk_dir.rglob("*.apk"))
    if len(apks) != 1:
        raise RuntimeError(f"Expected one APK, found {len(apks)}")
    installed = adb("install", "-r", str(apks[0]), check=False)
    print(installed.stdout + installed.stderr, flush=True)
    if installed.returncode:
        raise RuntimeError("Cannot install the ARM64 APK on this image; inspect ABI/translation support")
    adb("logcat", "-c")
    started = adb("shell", "am", "start", "-W", "-n", f"{package}/.MainActivity", check=False)
    (report_dir / "launch.txt").write_text(started.stdout + started.stderr)
    print(started.stdout + started.stderr, flush=True)
    # Release-mode React Native failures may arrive after ActivityManager reports success.
    for _ in range(15):
        time.sleep(1)
        if not adb("shell", "pidof", package, check=False).stdout.strip():
            raise RuntimeError("App process exited during cold launch")
    adb("shell", "uiautomator", "dump", "/sdcard/erp-launch.xml")
    xml = adb("shell", "cat", "/sdcard/erp-launch.xml").stdout
    (report_dir / "launch.xml").write_text(xml)
    if "连接工作空间" not in xml:
        raise RuntimeError("App did not render the native server setup screen")
    print("Native server setup rendered and process remained alive.", flush=True)
    subprocess.run([sys.executable, "scripts/android-ui-smoke.py", str(report_dir)], check=True)
finally:
    capture()
