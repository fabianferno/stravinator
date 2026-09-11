import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored MapLibre worker bundle, copied verbatim from node_modules and
    // served from /public. Not our code; see src/lib/scene/maplibreEngine.ts.
    "public/maplibre/**",
    // CesiumJS runtime assets, copied by scripts/copy-cesium-assets.mjs on
    // install. Not our code either.
    "public/cesium/**",
    ".worker/**",
  ]),
]);

export default eslintConfig;
