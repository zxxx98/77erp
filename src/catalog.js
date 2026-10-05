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
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPEG、PNG 或 WebP 图片。');
  if (file.size > 10 * 1024 * 1024) throw new Error('上传图片不能超过 10 MB。');
  const url = URL.createObjectURL(file);
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
    const image = canvas.toDataURL('image/jpeg', 0.82);
    if (image.length > Math.ceil(1024 * 1024 / 3) * 4 + 23) throw new Error('图片压缩后仍超过 1 MB，请选择较小的图片。');
    return image;
  } catch (e) {
    throw new Error(e.message.includes('MB') ? e.message : '图片无法读取，请选择有效的图片。');
  } finally { URL.revokeObjectURL(url); }
}
