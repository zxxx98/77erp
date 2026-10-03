let sequence = 0;
const pending = new Map();
let connectedBridge;

export function isAndroidApp() {
  return typeof window.ERPAndroid?.postMessage === "function";
}

export function androidRequest(action, payload = {}) {
  if (!isAndroidApp()) return Promise.reject(new Error("当前环境不支持手机操作。"));
  const bridge = window.ERPAndroid;
  if (connectedBridge !== bridge) {
    connectedBridge = bridge;
    bridge.onmessage = ({ data }) => {
      let response;
      try { response = JSON.parse(data); } catch { return; }
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      if (response.error) request.reject(new Error(response.error));
      else request.resolve(response.result);
    };
  }
  // Works on HTTP too, where crypto.randomUUID is unavailable.
  const id = `${Date.now()}-${++sequence}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try { bridge.postMessage(JSON.stringify({ ...payload, id, action })); }
    catch (error) { pending.delete(id); reject(error); }
  });
}

export async function downloadFile(text, filename, type = "text/plain") {
  if (isAndroidApp()) {
    await androidRequest("save", { text, filename, mime: type.split(";")[0] });
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
