import { t as translate, getFormatLocale } from './i18n/index.js';
import { AI_IMAGE_TYPES, AI_IMAGE_LIMIT, AI_IMAGE_SOURCE_LIMIT, AI_IMAGE_MAX_EDGE } from '../shared/ai-images.js';

export async function readAiImage(file) {
  if (!AI_IMAGE_TYPES.includes(file.type)) throw new Error(translate("system.please.select.a.jpg.png.or.webp.image"));
  if (file.size > AI_IMAGE_SOURCE_LIMIT) throw new Error(translate("system.a.single.original.image.cannot.exceed.10.mb"));
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error(translate("system.the.image.cannot.be.read.please.select.again")));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000)
      throw new Error(translate("system.the.image.resolution.is.too.large.please.crop.it.and.add"));
    const scale = Math.min(1, AI_IMAGE_MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error(translate("system.the.current.browser.cannot.process.the.image.please.try.another.browser"));
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.75, 0.55]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= AI_IMAGE_LIMIT) {
        const data_url = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error(translate("system.image.reading.failed.please.try.again")));
          reader.readAsDataURL(blob);
        });
        return { name: (file.name || translate("system.pasted.picture")).slice(0, 255), data_url };
      }
    }
    throw new Error(translate("system.the.image.is.still.over.1.mb.after.compression.please.crop"));
  } finally { URL.revokeObjectURL(url); }
}
