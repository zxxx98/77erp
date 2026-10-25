import { t as translate, getFormatLocale } from './i18n/index.js';
import { api } from './api.js';

export function flattenCategories(categories, parent = null, depth = 0, prefix = '') {
  return categories.filter(c => c.parent_id === parent).flatMap(c => {
    const path = prefix ? `${prefix} / ${c.name}` : c.name;
    return [{ ...c, depth, path }, ...flattenCategories(categories, c.id, depth + 1, path)];
  });
}

export function categoryBranch(categories, id) {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of categories) if (ids.has(c.parent_id) && !ids.has(c.id)) { ids.add(c.id); changed = true; }
  }
  return ids;
}

export async function readProductImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(translate("extra.please.select.a.jpeg.png.or.webp.image"));
  if (file.size > 10 * 1024 * 1024) throw new Error(translate("extra.upload.images.cannot.exceed.10.mb"));
  const url = URL.createObjectURL(file);
  let image;
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    image = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!image) throw new Error(translate("extra.the.image.cannot.be.read.please.select.a.valid.image"));
    if (image.size > 1024 * 1024) throw new Error(translate("extra.the.compressed.image.still.exceeds.1.mb.please.choose.a.smaller"));
  } catch (e) {
    throw new Error(e.message.includes('MB') ? e.message : translate("extra.the.image.cannot.be.read.please.select.a.valid.image"));
  } finally { URL.revokeObjectURL(url); }
  const body = new FormData();
  body.append('file', image, 'product.jpg');
  return (await api('/uploads/product-image', { method: 'POST', body })).url;
}
