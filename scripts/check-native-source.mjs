import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// Prevent accidentally restoring the browser shell in the native application.
function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(resolve(directory, entry.name))
      : [resolve(directory, entry.name)],
  );
}
for (const file of [...walk("mobile/src"), ...walk("android/app/src/main")]) {
  if (
    /\.(tsx?|jsx?|java|kt|xml)$/.test(file) &&
    /android\.webkit|react-native-webview|\bWebView\b|addJavascriptInterface|dangerouslySetInnerHTML/.test(
      readFileSync(file, "utf8"),
    )
  ) {
    throw new Error(`Native application must not embed web pages: ${file}`);
  }
}
const root = JSON.parse(readFileSync("package.json", "utf8"));
const mobile = JSON.parse(readFileSync("mobile/package.json", "utf8"));
if (mobile.version !== root.version)
  throw new Error("Root and mobile release versions must match.");
if (mobile.dependencies["react-native-webview"])
  throw new Error("WebView dependency is not allowed.");
console.log("Native source and release version checks passed.");
