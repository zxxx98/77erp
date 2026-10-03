import { readFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function androidVersion(version, tag) {
  if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error("版本号必须是 x.y.z 正式版本，例如 1.0.0。");
  }
  const [major, minor, patch] = version.split(".").map(Number);
  const versionCode = major * 1_000_000 + minor * 1_000 + patch;
  if (major > 2099 || minor > 999 || patch > 999 || versionCode < 1) {
    throw new Error("major 不能超过 2099，minor/patch 不能超过 999，版本不能是 0.0.0。");
  }
  if (tag !== undefined && tag !== `v${version}`) {
    throw new Error(`标签 ${tag} 与 package.json 的版本 v${version} 不一致。`);
  }
  return { versionName: version, versionCode };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const result = androidVersion(version, process.argv[2]);
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.versionName}\nversion_code=${result.versionCode}\n`);
  }
}
