// Device identity selects the shell; viewport size only adapts its layout.
export function isMobileDevice(browser = globalThis.navigator) {
  if (!browser) return false;
  if (browser.userAgentData?.mobile === true) return true;
  const ua = browser.userAgent || '';
  if (/Android|iPhone|iPad|iPod|HarmonyOS|Mobile|Tablet|Silk|Kindle/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && browser.maxTouchPoints > 1;
}

export const mobileDevice = isMobileDevice();
if (typeof document !== 'undefined') {
  document.documentElement.classList.toggle('mobile-device', mobileDevice);
}
