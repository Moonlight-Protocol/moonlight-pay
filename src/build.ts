/**
 * Bundles src/app.ts into public/app.js for the browser.
 *
 * Uses esbuild via npm and the deno loader plugin for import-map resolution.
 * After bundling, applies post-build patches for Node built-ins that leak
 * through transitive deps:
 *   - `buffer`: CJS __require("buffer") patched to return globalThis polyfill,
 *     bare ESM imports removed (polyfill injected via src/shims/buffer.ts)
 *   - `node:crypto`: ESM import replaced with Web Crypto shim
 *
 * This matches the approach used by council-console and provider-console.
 *
 * IMPORTANT — DO NOT REMOVE the `stellar-sdk` entry from deno.json's
 * imports. It looks unused (no `import` from src/) but it's load-bearing:
 * it pins the wallets-kit's `@stellar/stellar-sdk` peer dep to 14.2.0.
 * Without it, Deno re-resolves with newer transitive deps (near-api-js,
 * react, multiple bufferutil/utf-8-validate variants) that produce a
 * cache directory path exceeding macOS's 255-char filesystem limit, and
 * the build fails with "File name too long (os error 63)".
 *
 * IMPORTANT — DO NOT REGENERATE deno.lock from scratch on macOS. The
 * committed lock file pins the kit to a short-path resolution; deleting
 * it and re-resolving will pull a different transitive tree that hits
 * the same path-too-long bug. If you need to update the lock, do it on
 * Linux/CI and commit the result.
 */
import * as esbuild from "esbuild";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import { fromFileUrl, resolve } from "@std/path";

const SRC_DIR = fromFileUrl(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(SRC_DIR, "..");
const ENTRY_POINT = resolve(SRC_DIR, "app.ts");
const BUFFER_SHIM = resolve(SRC_DIR, "shims/buffer.ts");
const OUTFILE = resolve(PROJECT_ROOT, "public/app.js");
const DENO_JSON = resolve(PROJECT_ROOT, "deno.json");

const isProduction = Deno.args.includes("--production");
const denoJson = JSON.parse(await Deno.readTextFile(DENO_JSON));
const version = denoJson.version ?? "0.0.0";

await esbuild.build({
  entryPoints: [ENTRY_POINT],
  bundle: true,
  outfile: OUTFILE,
  format: "esm",
  platform: "browser",
  target: "es2022",
  supported: { decorators: false },
  minify: isProduction,
  sourcemap: !isProduction,
  define: {
    "__APP_VERSION__": JSON.stringify(version),
    "__DEV_MODE__": JSON.stringify(!isProduction),
  },
  inject: [BUFFER_SHIM],
  treeShaking: false,
  plugins: [
    // deno-lint-ignore no-explicit-any
    ...(denoPlugins({ configPath: DENO_JSON }) as any[]),
  ],
});

// ─── Post-build patches ────────────────────────────────────────
let appJs = await Deno.readTextFile(OUTFILE);
const before = appJs;

// 1. Patch __require: intercept require("buffer") before it throws
appJs = appJs.replace(
  /throw\s*(Error\('Dynamic require of "'\s*\+\s*(\w+)\s*\+\s*'" is not supported'\))/,
  (_match, errExpr, varName) =>
    `if(${varName}==="buffer")return globalThis.__buffer_polyfill;throw ${errExpr}`,
);

if (appJs === before) {
  esbuild.stop();
  throw new Error(
    "Build failed: could not patch __require for buffer polyfill. " +
      "esbuild's CJS shim format may have changed.",
  );
}

// 2. Remove bare ESM buffer imports
appJs = appJs.replace(
  /import\s*\{[^}]*\}\s*from\s*"buffer"\s*;?/g,
  "",
);

// 3. Replace node:buffer imports with polyfill reference
appJs = appJs.replace(
  /import\s*\{([^}]*)\}\s*from\s*"node:buffer"\s*;?/g,
  (_match, names) => {
    const exports = names.split(",").map((n: string) => n.trim()).filter(
      Boolean,
    );
    return exports.map((n: string) => {
      const [original, alias] = n.split(/\s+as\s+/).map((s: string) =>
        s.trim()
      );
      const localName = alias || original;
      if (original === "Buffer") {
        return `var ${localName} = globalThis.__buffer_polyfill.Buffer;`;
      }
      return `var ${localName} = globalThis.__buffer_polyfill.${original};`;
    }).join("\n");
  },
);

// 4. Replace node:crypto import with Web Crypto shim
appJs = appJs.replace(
  /import\s*\{([^}]*)\}\s*from\s*"node:crypto"\s*;?/g,
  (_match, names) => {
    const exports = names.split(",").map((n: string) => n.trim()).filter(
      Boolean,
    );
    const shims: string[] = [];
    for (const name of exports) {
      if (name === "randomBytes") {
        shims.push(
          "var randomBytes = (size) => globalThis.crypto.getRandomValues(new Uint8Array(size));",
        );
      }
    }
    return shims.join("\n");
  },
);

await Deno.writeTextFile(OUTFILE, appJs);

esbuild.stop();
console.log(`Built public/app.js${isProduction ? " (production)" : ""}`);
