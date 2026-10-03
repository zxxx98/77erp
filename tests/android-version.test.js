import test from "node:test";
import assert from "node:assert/strict";
import { androidVersion } from "../scripts/android-version.mjs";

test("Android version code increases across patch, minor and major releases", () => {
  const versions = ["0.0.1", "0.999.999", "1.0.0", "1.0.1", "1.1.0", "2.0.0", "2099.999.999"];
  const codes = versions.map((version) => androidVersion(version, `v${version}`).versionCode);
  assert.deepEqual(codes, [...codes].sort((a, b) => a - b));
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(androidVersion("1.2.3").versionCode, 1002003);
  assert.ok(codes.at(-1) <= 2100000000);
});

test("reject invalid or overflowing versions and tags that do not match package.json", () => {
  for (const version of ["1.0", "v1.0.0", "01.0.0", "1.0.0-beta.1", "0.0.0", "1.1000.0", "1.0.1000", "2100.0.0", "99999999999999999999.0.0"]) {
    assert.throws(() => androidVersion(version));
  }
  assert.throws(() => androidVersion("1.0.0", "v1.0.1"), /不一致/);
  assert.throws(() => androidVersion("1.0.0", "1.0.0"), /不一致/);
});
