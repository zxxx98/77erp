import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException } from '@zxing/library';
import { cameraRegion, createCameraDecoder } from '../src/camera-decoder.js';

test('camera crop matches the visible guide in portrait, landscape and desktop previews', () => {
  assert.deepEqual(cameraRegion(1280, 720, { x: 0, y: 0, width: 360, height: 720 },
    { x: 80, y: 200, width: 200, height: 200 }), { x: 540, y: 200, width: 200, height: 200 });
  assert.deepEqual(cameraRegion(720, 1280, { x: 0, y: 0, width: 720, height: 360 },
    { x: 200, y: 80, width: 200, height: 200 }), { x: 200, y: 540, width: 200, height: 200 });
  assert.deepEqual(cameraRegion(1280, 720, { x: 20, y: 30, width: 640, height: 360 },
    { x: 180, y: 120, width: 320, height: 180 }), { x: 320, y: 180, width: 640, height: 360 });
});

const loadReader = async () => ({ decodeFromCanvas: () => ({ getText: () => 'JS-result' }) });

test('native detection uses supported formats and avoids loading ZXing on success', async () => {
  class Detector {
    static async getSupportedFormats() { return ['qr_code', 'code_128', 'unknown']; }
    constructor(options) { assert.deepEqual(options.formats, ['qr_code', 'code_128']); }
    async detect() { return [{ rawValue: '' }, { rawValue: 'native-result' }]; }
  }
  const decode = await createCameraDecoder({ Detector, loadReader: () => assert.fail('unnecessary JS decoder') });
  assert.equal(await decode({}), 'native-result');
});

test('missing, unsupported and broken native backends all use the JS decoder', async () => {
  for (const Detector of [null,
    class { static async getSupportedFormats() { return []; } },
    class { static async getSupportedFormats() { throw new Error('unavailable'); } },
    class { static async getSupportedFormats() { return ['qr_code']; } constructor() { throw new Error('unavailable'); } },
  ]) {
    const decode = await createCameraDecoder({ Detector, loadReader });
    assert.equal(await decode({}), 'JS-result');
  }
});

test('native misses fall back at a limited rate; expanded frames still get a JS attempt', async () => {
  let timestamp = 0, loads = 0, jsAttempts = 0;
  class Detector {
    static async getSupportedFormats() { return ['qr_code']; }
    async detect() { return []; }
  }
  const decode = await createCameraDecoder({ Detector, now: () => timestamp, loadReader: async () => {
    loads++;
    return { decodeFromCanvas: () => { jsAttempts++; throw new NotFoundException(); } };
  } });
  assert.equal(await decode({}), null);
  timestamp = 100;
  assert.equal(await decode({}), null);
  assert.equal(jsAttempts, 1);
  timestamp = 300;
  assert.equal(await decode({}), null);
  assert.equal(jsAttempts, 2);
  timestamp = 400;
  assert.equal(await decode({}, true), null);
  assert.equal(jsAttempts, 3);
  assert.equal(loads, 1);
});

test('a detector runtime error disables that backend and does not interrupt scanning', async () => {
  let attempts = 0;
  class Detector {
    static async getSupportedFormats() { return ['qr_code']; }
    async detect() { attempts++; throw new Error('platform failure'); }
  }
  const decode = await createCameraDecoder({ Detector, loadReader });
  assert.equal(await decode({}), 'JS-result');
  assert.equal(await decode({}), 'JS-result');
  assert.equal(attempts, 1);
});
