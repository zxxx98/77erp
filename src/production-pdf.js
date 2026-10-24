export async function downloadProductionPdf(order, warehouseId) {
  const response = await fetch(`/api/production-orders/${order.id}/pdf?origin=${encodeURIComponent(location.origin)}`, {
    credentials: 'same-origin', headers: { 'X-Warehouse-ID': String(warehouseId) },
  });
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('erp:unauthorized'));
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || '导出 PDF 失败，请稍后重试。');
  }
  if (!(response.headers.get('content-type') || '').includes('application/pdf')) throw new Error('服务器未返回有效的 PDF，请刷新后重试。');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url; link.download = `生产单-${order.number.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.pdf`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
