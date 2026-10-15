import { ChecksumException, FormatException, NotFoundException } from '@zxing/library';

// Map the on-screen guide back to the camera image, including object-fit: cover.
export function cameraRegion(width, height, preview, guide = preview) {
  const scale = Math.max(preview.width / width, preview.height / height);
  const offsetX = (width * scale - preview.width) / 2;
  const offsetY = (height * scale - preview.height) / 2;
  const x = Math.max(0, (guide.x - preview.x + offsetX) / scale);
  const y = Math.max(0, (guide.y - preview.y + offsetY) / scale);
  const right = Math.min(width, (guide.x - preview.x + guide.width + offsetX) / scale);
  const bottom = Math.min(height, (guide.y - preview.y + guide.height + offsetY) / scale);
  return { x, y, width: right - x, height: bottom - y };
}

const nativeFormats = ['qr_code', 'code_128', 'code_39', 'code_93', 'ean_13', 'ean_8',
  'upc_a', 'upc_e', 'itf', 'codabar', 'data_matrix', 'pdf417', 'aztec'];

async function loadZxing() {
  const { BrowserMultiFormatReader } = await import('@zxing/browser');
  return new BrowserMultiFormatReader();
}

export async function createCameraDecoder({ Detector = globalThis.BarcodeDetector, loadReader = loadZxing,
  now = () => performance.now() } = {}) {
  let detector, readerPromise, lastFallback = -Infinity;
  if (Detector?.getSupportedFormats) {
    try {
      const supported = await Detector.getSupportedFormats();
      const formats = nativeFormats.filter(format => supported.includes(format));
      if (formats.length) detector = new Detector({ formats });
    } catch { /* Some browsers expose the API without a working native backend. */ }
  }
  return async (canvas, expanded = false) => {
    if (detector) {
      try {
        const results = await detector.detect(canvas);
        const value = results.find(result => typeof result.rawValue === 'string' && result.rawValue.length)?.rawValue;
        if (value) return value;
      } catch {
        // A broken platform backend should not keep delaying the JS decoder.
        detector = null;
      }
      // Keep native scans frequent without running expensive JS on every miss.
      if (detector && !expanded && now() - lastFallback < 300) return null;
    }
    lastFallback = now();
    readerPromise ||= loadReader();
    const reader = await readerPromise;
    try { return reader.decodeFromCanvas(canvas).getText(); }
    catch (error) {
      if (error instanceof NotFoundException || error instanceof ChecksumException || error instanceof FormatException) return null;
      throw error;
    }
  };
}
