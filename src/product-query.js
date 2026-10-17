import { useEffect, useState } from 'react';
import { api } from './api.js';
import { parseProductCode, resolveProductCode } from './product-scan.js';
import { useQuery, queryPath } from './queries.js';

export async function lookupProductCode(raw, data) {
  const code = parseProductCode(raw);
  if (code.kind === 'label') {
    // Validate the label's scope before requesting its record.
    resolveProductCode(raw, { products: [{ id: code.id, barcode: code.barcode }], warehouseId: data.warehouse_id, sourceId: data.instance_id });
  }
  try {
    const result = await api(code.kind === 'label' ? `/products/${code.id}` : `/products/barcode/${encodeURIComponent(code.barcode)}`, { warehouseId: data.warehouse_id });
    const product = result.product || result;
    return resolveProductCode(raw, { products: [product], warehouseId: data.warehouse_id, sourceId: data.instance_id });
  } catch (error) {
    if (error.status === 404 && code.kind === 'barcode') return null;
    throw error;
  }
}

export function useProductSelection(data, items, query, includeInactive, initialProduct) {
  const [cache, setCache] = useState(() => initialProduct ? [initialProduct] : []);
  const [error, setError] = useState('');
  const search = useQuery(query.trim() ? queryPath('/products', { q: query, status: includeInactive ? 'all' : 'active', limit: 20 }) : null, data, query ? 250 : 0);
  const remember = product => setCache(previous => [...previous.filter(p => p.id !== product.id), product]);
  const ids = [...new Set(items.map(item => item.product_id))].sort((a, b) => a - b).join(',');
  useEffect(() => {
    if (!data.warehouse_id) return;
    const controller = new AbortController();
    setError('');
    Promise.all(ids.split(',').filter(Boolean).map(id => api(`/products/${id}`, { warehouseId: data.warehouse_id, signal: controller.signal })
      .then(({ product }) => product).catch(error => { if (error.status === 404) return null; throw error; })))
      .then(products => { if (!controller.signal.aborted) setCache(previous => [...previous.filter(p => !ids.split(',').includes(String(p.id))), ...products.filter(Boolean)]); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [ids, data]);
  const matches = search.result?.products || [];
  return { products: [...cache, ...matches.filter(p => !cache.some(c => c.id === p.id))], matches, remember, error: error || search.error, loading: search.loading };
}
