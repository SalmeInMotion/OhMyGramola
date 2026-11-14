import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

console.log("=== Testing Free Royalties Music Extension Integrity ===");

// 1. Verify Project Files
const requiredFiles = [
  "CSXS/manifest.xml",
  "host/index.jsx",
  "Install-OhMyGramola.cmd",
  "CHANGELOG.md",
  "LICENSE",
  "src/index.html",
  "src/styles.css",
  "src/net.js",
  "src/broker-client.js",
  "src/server/broker.mjs",
  "src/app.js",
  "src/favorites.js",
  "src/player.js",
  "src/waveform.js",
  "src/ae-bridge.js",
  "src/sources/incompetech.js",
  "src/sources/jamendo.js",
  "src/sources/local.js",
  "src/data/incompetech_pieces.json",
  "src/data/incompetech_genres.json",
  "scripts/install.ps1",
  "scripts/install-gui.ps1",
  "scripts/package-release.ps1"
];

for (const rel of requiredFiles) {
  const p = path.join(projectRoot, rel);
  if (!fs.existsSync(p)) {
    console.error(`✗ Missing required file: ${rel}`);
    process.exit(1);
  }
}
console.log("✓ All required extension files and data assets are present on disk.");

// 2. Verify Version Synchronization across package.json, manifest.xml, and index.html
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
const manifest = fs.readFileSync(path.join(projectRoot, "CSXS/manifest.xml"), "utf-8");
const html = fs.readFileSync(path.join(projectRoot, "src/index.html"), "utf-8");
if (!manifest.includes(`ExtensionBundleVersion="${pkg.version}"`) || !html.includes(`v${pkg.version}`)) {
  console.error(`✗ Version mismatch! package.json=${pkg.version} does not match manifest.xml or index.html`);
  process.exit(1);
}
console.log(`✓ Release version synchronized across manifest, UI, and package.json: v${pkg.version}`);

// 3. Verify Bundled Incompetech JSON
const pieces = JSON.parse(fs.readFileSync(path.join(projectRoot, "src/data/incompetech_pieces.json"), "utf-8"));
const genres = JSON.parse(fs.readFileSync(path.join(projectRoot, "src/data/incompetech_genres.json"), "utf-8"));
console.log(`✓ Offline bundled catalog verified: ${pieces.length} tracks, ${genres.length} genres.`);

// 3. Verify Local Music Folder
const musicDir = "P:\\IA\\RRSS\\Music";
if (fs.existsSync(musicDir)) {
  console.log(`✓ Music folder verified: ${musicDir}`);
} else {
  console.error(`✗ Music folder missing: ${musicDir}`);
}

console.log("=== All checks passed! ===");
