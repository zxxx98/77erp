import test from 'node:test';
import assert from 'node:assert/strict';
import { isMobileDevice } from '../src/device.js';

test('phones and tablets select mobile regardless of viewport width or a false UA mobile hint', () => {
  for (const userAgent of [
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
  ]) assert.equal(isMobileDevice({ userAgent, userAgentData: { mobile: false }, maxTouchPoints: 5 }), true);
  assert.equal(isMobileDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15', maxTouchPoints: 5 }), true);
});

test('desktop browsers including Windows touch computers remain PC', () => {
  assert.equal(isMobileDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0', maxTouchPoints: 10 }), false);
  assert.equal(isMobileDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15', maxTouchPoints: 0 }), false);
  assert.equal(isMobileDevice({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/132.0', userAgentData: { mobile: false } }), false);
  assert.equal(isMobileDevice({ userAgent: 'Unknown browser', userAgentData: { mobile: true } }), true);
});
