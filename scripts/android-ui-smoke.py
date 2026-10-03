"""Exercise native layouts against isolated, disposable API fixtures in CI."""
import json
import pathlib
import re
import subprocess
import sys
import threading
import time
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, HTTPServer

reports = pathlib.Path(sys.argv[1])
package = "com.erp77.app"
product = {
    "id": 1, "name": "超长商品名称用于原生界面适配检查陶瓷马克杯礼盒装",
    "barcode": "SKU-000001-123456789012345678901234567890",
    "category": "办公用品及日常生活用品礼品组合分类", "unit": "整箱礼盒包装",
    "stock": 99999, "threshold": 100000, "price": 999999.99, "cost": 888888.88,
}
workspace = {
    "products": [product], "orders": [],
    "settings": {"business_name": "原生适配测试商户", "warehouse_name": "用于测试长名称的主仓库"},
}


class FixtureAPI(BaseHTTPRequestHandler):
    def do_GET(self):
        data = ({"initialized": True, "authenticated": True, "username": "layout-test"}
                if self.path == "/api/auth/status" else workspace)
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


def adb(*args):
    return subprocess.run(["adb", *args], capture_output=True, text=True, timeout=45, check=True).stdout


def tree():
    adb("shell", "uiautomator", "dump", "/sdcard/erp-ui.xml")
    return ET.fromstring(adb("shell", "cat", "/sdcard/erp-ui.xml"))


def find(label=None, class_name=None):
    for _ in range(8):
        for node in tree().iter("node"):
            if ((label is not None and label in (node.get("text"), node.get("content-desc")))
                    or (class_name is not None and node.get("class") == class_name)):
                return node
        time.sleep(1)
    raise RuntimeError(f"Native control not found: {label or class_name}")


def tap_node(node):
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", node.get("bounds")))
    if x2 <= x1 or y2 <= y1:
        raise RuntimeError("Cannot tap an empty native control")
    adb("shell", "input", "tap", str((x1+x2)//2), str((y1+y2)//2))
    time.sleep(1)


def tap(label):
    tap_node(find(label=label))


def snapshot(name):
    root = tree()
    (reports / f"{name}.xml").write_text(ET.tostring(root, encoding="unicode"))
    with (reports / f"{name}.png").open("wb") as output:
        subprocess.run(["adb", "exec-out", "screencap", "-p"], stdout=output, check=True, timeout=30)
    if not adb("shell", "pidof", package).strip():
        raise RuntimeError(f"App exited while capturing {name}")


def restart():
    adb("shell", "am", "force-stop", package)
    adb("shell", "am", "start", "-W", "-n", f"{package}/.MainActivity")
    find(label="工作台")


server = HTTPServer(("127.0.0.1", 8765), FixtureAPI)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    snapshot("01-server")
    tap_node(find(class_name="android.widget.EditText"))
    adb("shell", "input", "text", "http://10.0.2.2:8765")
    adb("shell", "input", "keyevent", "4")
    tap("连接服务器")
    find(label="工作台")
    snapshot("02-dashboard")
    tap("商品")
    snapshot("03-products")
    tap(f"{product['name']}，库存 {product['stock']} {product['unit']}")
    find(label="商品详情")
    snapshot("04-product-detail")
    tap("采购入库")
    find(label="供应商")
    snapshot("05-order-form")

    # 320 dp wide with 2x system text, then landscape. Settings survive cold starts.
    adb("shell", "wm", "size", "960x1800")
    adb("shell", "wm", "density", "480")
    adb("shell", "settings", "put", "system", "font_scale", "2.0")
    restart()
    snapshot("06-dashboard-small-large-text")
    tap("商品")
    snapshot("07-products-small-large-text")
    tap("新增商品")
    find(label="商品名称")
    snapshot("08-form-small-large-text")
    tap_node(find(class_name="android.widget.EditText"))
    adb("shell", "input", "text", "Native-layout-test")
    snapshot("09-form-keyboard-large-text")
    adb("shell", "input", "keyevent", "4")
    adb("shell", "settings", "put", "system", "accelerometer_rotation", "0")
    adb("shell", "settings", "put", "system", "user_rotation", "1")
    time.sleep(2)
    snapshot("10-form-landscape-large-text")
    print("Native navigation and layout scenarios completed.", flush=True)
finally:
    server.shutdown()
    adb("shell", "settings", "put", "system", "font_scale", "1.0")
    adb("shell", "settings", "put", "system", "user_rotation", "0")
    adb("shell", "wm", "size", "reset")
    adb("shell", "wm", "density", "reset")
