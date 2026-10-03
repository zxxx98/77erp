import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// npm's version lifecycle runs after updating the root version and before creating its commit/tag.
const root = new URL("../", import.meta.url);
const { version } = JSON.parse(
  readFileSync(new URL("package.json", root), "utf8"),
);
for (const file of ["mobile/package.json", "mobile/package-lock.json"]) {
  const path = new URL(file, root);
  const json = JSON.parse(readFileSync(path, "utf8"));
  json.version = version;
  if (json.packages?.[""]) json.packages[""].version = version;
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
}
if (process.env.npm_config_git_tag_version !== "false") {
  execFileSync(
    "git",
    ["add", "mobile/package.json", "mobile/package-lock.json"],
    { cwd: root },
  );
}
console.log(`Mobile release version synchronized: ${version}`);
