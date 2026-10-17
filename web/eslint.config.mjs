import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Static export + client-only data: "mounted" flags and resetting pagination on
      // filter change are intentional effects. Keep them visible but non-blocking.
      "react-hooks/set-state-in-effect": "warn",
      // Images are served unoptimized from the embedded static export anyway.
      "@next/next/no-img-element": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }]
    }
  },
  {
    files: ["components/theme-customizer/**"],
    rules: { "@typescript-eslint/no-explicit-any": "warn" }
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
