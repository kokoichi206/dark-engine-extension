import { context } from "esbuild";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { watch as watchFile } from "node:fs";

const watch = process.argv.includes("--watch");
await mkdir("dist", { recursive: true });
async function copyAssets() {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
  await writeFile(
    "dist/manifest.json",
    JSON.stringify({ ...manifest, version: pkg.version }, null, 2) + "\n",
  );
  await cp("src/popup/popup.html", "dist/popup.html");
  await cp("src/popup/popup.css", "dist/popup.css");
  await cp("src/options/options.html", "dist/options.html");
  await cp("src/options/options.css", "dist/options.css");
}
await copyAssets();
const build = await context({
  entryPoints: {
    content: "src/entries/content.ts",
    sheets: "src/entries/sheets.ts",
    popup: "src/popup/popup.ts",
    options: "src/options/options.ts",
  },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome119",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
});
if (watch) {
  await build.watch();
  for (const file of [
    "manifest.json",
    "package.json",
    "src/popup/popup.html",
    "src/popup/popup.css",
    "src/options/options.html",
    "src/options/options.css",
  ]) {
    watchFile(file, () => {
      void copyAssets().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    });
  }
  console.log(
    "ソースの変更を監視しています。変更後は chrome://extensions で拡張を更新し、対象ページを再読み込みしてください。",
  );
} else {
  await build.rebuild();
  await build.dispose();
}
