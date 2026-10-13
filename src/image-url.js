export function productThumbnailUrl(src, size) {
  if (!Number.isSafeInteger(size) || size < 1 || size > 4096 || !/^https:\/\/[^/?#]+\/file\/[^?#]+$/.test(src)) return src;
  return `${src}?width=${size}&height=${size}&fallback=original`;
}
