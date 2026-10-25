import { getLocale, t } from './i18n/index.js';
export async function downloadProductionPdf(order, warehouseId, language = getLocale()) {
  const response = await fetch(`/api/production-orders/${order.id}/pdf?origin=${encodeURIComponent(location.origin)}&language=${encodeURIComponent(language)}`, {
    credentials: 'same-origin', headers: { 'X-Warehouse-ID': String(warehouseId), 'Accept-Language': language },
  });
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('erp:unauthorized'));
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || body.error || t('export.pdfFailed'));
  }
  if (!(response.headers.get('content-type') || '').includes('application/pdf')) throw new Error(t('export.pdfInvalid'));
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url; link.download = `${t('export.productionOrder', { lng: language })}-${order.number.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.pdf`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
