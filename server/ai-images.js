import sharp from 'sharp';
import { AI_IMAGE_TYPES, AI_IMAGE_LIMIT, AI_IMAGE_MAX_COUNT, AI_IMAGE_MAX_EDGE } from '../shared/ai-images.js';

const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
const formats = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };

export async function normalizeAiImages(images) {
  if (images === undefined) return [];
  if (!Array.isArray(images) || images.length > AI_IMAGE_MAX_COUNT) invalid(`每次最多添加 ${AI_IMAGE_MAX_COUNT} 张图片。`);
  const result = [];
  // Decode one image at a time to bound memory usage on phones' large photos.
  for (const image of images) {
    if (!image || typeof image.name !== 'string' || !image.name.trim() || image.name.length > 255) invalid('图片名称无效。');
    if (typeof image.data_url !== 'string' || image.data_url.length > Math.ceil(AI_IMAGE_LIMIT / 3) * 4 + 40) invalid('压缩后的图片不能超过 1 MB。');
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.data_url);
    if (!match || !AI_IMAGE_TYPES.includes(match[1])) invalid('请选择 JPG、PNG 或 WebP 图片。');
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > AI_IMAGE_LIMIT || buffer.toString('base64') !== match[2]) invalid('图片数据无效或超过 1 MB。');
    try {
      const source = sharp(buffer, { limitInputPixels: 40_000_000, animated: false });
      const meta = await source.metadata();
      if (meta.format !== formats[match[1]] || (meta.pages || 1) > 1) invalid('图片内容与格式不符，或不是静态图片。');
      const normalized = await source.rotate().resize(AI_IMAGE_MAX_EDGE, AI_IMAGE_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#fff' }).webp({ quality: 85 }).toBuffer();
      if (normalized.length > AI_IMAGE_LIMIT) invalid('图片内容过大，请裁剪后重新添加。');
      result.push({ name: image.name.trim(), data_url: `data:image/webp;base64,${normalized.toString('base64')}` });
    } catch (error) {
      if (error.status) throw error;
      invalid('图片无法读取，请选择有效的 JPG、PNG 或 WebP 图片。');
    }
  }
  return result;
}

export function aiTranscript(messages) {
  return messages.filter(m => ['user', 'assistant'].includes(m.role) && m.content)
    .map(({ role, content, attachment, images }) => ({ role, content, ...(attachment ? { attachment } : {}), ...(images?.length ? { images } : {}) }));
}

export function aiModelMessages(messages) {
  return messages.map(({ attachment, images, ...message }) => ({ ...message,
    ...(message.role === 'user' && images?.length ? { content: [
      { type: 'text', text: message.content },
      ...images.map(image => ({ type: 'image_url', image_url: { url: image.data_url } })),
    ] } : {}),
  }));
}
