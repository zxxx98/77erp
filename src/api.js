let warehouseId = Number(new URLSearchParams(location.search).get('warehouse_id') || localStorage.getItem('77erp-warehouse')) || 1;
export const getWarehouseId = () => warehouseId;
export function setWarehouseId(id) {
  warehouseId = id;
  localStorage.setItem('77erp-warehouse', String(id));
  const url = new URL(location.href);
  if (url.searchParams.has('warehouse_id')) {
    url.searchParams.delete('warehouse_id');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
}
export async function api(path, options) {
  const { warehouseId: selected = warehouseId, ...request } = options || {};
  const multipart = options?.body instanceof FormData;
  const res = await fetch("/api" + path, {
    credentials: "same-origin",
    ...(!path.startsWith('/auth/') ? { headers: { 'X-Warehouse-ID': String(selected) } } : {}),
    ...(options
      ? {
          ...request,
          headers: { ...(!multipart ? { "Content-Type": "application/json" } : {}), ...(!path.startsWith('/auth/') ? { 'X-Warehouse-ID': String(selected) } : {}), ...request.headers },
          body: multipart ? options.body : options.body ? JSON.stringify(options.body) : undefined,
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
    error.code = data.code;
    error.details = data.details;
    throw error;
  }
  return data;
}
