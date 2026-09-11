// CesiumJS loads its web workers, shaders, and textures at runtime from
// `CESIUM_BASE_URL`, not through the bundler. Copy those static folders into
// `public/cesium` on install so Next serves them; the folder is gitignored.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "node_modules", "cesium", "Build", "Cesium");
const dest = join(root, "public", "cesium");

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ["Workers", "Assets", "ThirdParty", "Widgets"]) {
  cpSync(join(src, dir), join(dest, dir), { recursive: true });
}
