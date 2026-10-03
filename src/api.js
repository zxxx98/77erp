export async function api(path, options) {
  const res = await fetch("/api" + path, {
    credentials: "same-origin",
    ...(options
      ? {
          ...options,
          headers: { "Content-Type": "application/json" },
          body: options.body ? JSON.stringify(options.body) : undefined,
        }
      : {}),
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) {
      window.dispatchEvent(new Event("erp:unauthorized"));
    }
    const error = new Error(data.error || "请求失败，请重试。");
    error.status = res.status;
    throw error;
  }
  return data;
}
