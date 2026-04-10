/**
 * Bundles src/app.ts into public/app.js for the browser.
 *
 * Uses esbuild via npm (deno.land/x/esbuild is deprecated) and the deno
 * loader plugin for import-map resolution. A small inline plugin handles
 * the `buffer` import that the wallets-kit transitive deps depend on:
 * instead of post-build regex-patching esbuild's CJS shim, we intercept
 * any `import "buffer"` (or static `require("buffer")`) at resolve time
 * and route it to a virtual module that re-exports the Buffer polyfill
 * we install on `globalThis` via the inject shim.
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

// Resolve build inputs against this file's location, not the cwd, so the
// build works regardless of where `deno task build` is invoked from.
const SRC_DIR = fromFileUrl(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(SRC_DIR, "..");
const ENTRY_POINT = resolve(SRC_DIR, "app.ts");
const BUFFER_SHIM = resolve(SRC_DIR, "shims/buffer.ts");
const OUTFILE = resolve(PROJECT_ROOT, "public/app.js");
const DENO_JSON = resolve(PROJECT_ROOT, "deno.json");

const isProduction = Deno.args.includes("--production");
const denoJson = JSON.parse(await Deno.readTextFile(DENO_JSON));
const version = denoJson.version ?? "0.0.0";

/**
 * Intercept any `buffer` import (ESM or static CJS require) and resolve it
 * to a virtual module that pulls the Buffer constructor off globalThis,
 * where the inject shim has placed it. Listed BEFORE denoPlugins so it
 * wins the resolve race for the literal `buffer` specifier.
 */
const bufferShimPlugin: esbuild.Plugin = {
  name: "moonlight-buffer-polyfill",
  setup(build) {
    build.onResolve({ filter: /^buffer$/ }, () => ({
      path: "buffer",
      namespace: "moonlight-buffer-polyfill",
    }));
    build.onLoad(
      { filter: /.*/, namespace: "moonlight-buffer-polyfill" },
      () => ({
        contents: `
          const polyfill = globalThis.__buffer_polyfill;
          if (!polyfill || !polyfill.Buffer) {
            throw new Error(
              "Buffer polyfill missing on globalThis. " +
              "src/shims/buffer.ts must be injected into the bundle."
            );
          }
          export const Buffer = polyfill.Buffer;
          export default polyfill;
        `,
        loader: "js",
      }),
    );
  },
};

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
    bufferShimPlugin,
    ...denoPlugins({ configPath: DENO_JSON }),
  ],
});

esbuild.stop();
console.log(`Built public/app.js${isProduction ? " (production)" : ""}`);
