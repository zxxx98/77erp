export function productThumbnailUrl(uri: string, size?: number): string {
  // Keep URL construction independent of React Native's partial URL implementation.
  if (size === undefined || !Number.isSafeInteger(size) || size < 1 || size > 4096 || !/^https:\/\/[^/?#]+\/file\/[^?#]+$/.test(uri)) return uri;
  return `${uri}?width=${size}&height=${size}&fallback=original`;
}
