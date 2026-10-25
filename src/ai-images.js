import { AI_IMAGE_TYPES, AI_IMAGE_LIMIT, AI_IMAGE_SOURCE_LIMIT, AI_IMAGE_MAX_EDGE } from '../shared/ai-images.js';

export async function readAiImage(file) {
  if (!AI_IMAGE_TYPES.includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片。');
  if (file.size > AI_IMAGE_SOURCE_LIMIT) throw new Error('单张原图不能超过 10 MB。');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('图片无法读取，请重新选择。'));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000)
      throw new Error('图片分辨率过大，请裁剪后重新添加。');
    const scale = Math.min(1, AI_IMAGE_MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法处理图片，请换个浏览器重试。');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.75, 0.55]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= AI_IMAGE_LIMIT) {
        const data_url = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('图片读取失败，请重试。'));
          reader.readAsDataURL(blob);
        });
        return { name: (file.name || '粘贴的图片').slice(0, 255), data_url };
      }
    }
    throw new Error('图片压缩后仍超过 1 MB，请裁剪后重新添加。');
  } finally { URL.revokeObjectURL(url); }
}
