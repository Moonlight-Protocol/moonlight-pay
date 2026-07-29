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
 * it pins the wallets-kit's `@stellar/stellar-sdk` peer dep. Without it,
 * Deno re-resolves with newer transitive deps (near-api-js, react,
 * multiple bufferutil/utf-8-validate variants) that produce a cache
 * directory path exceeding macOS's 255-char filesystem limit, and the
 * build fails with "File name too long (os error 63)".
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
const HEALTH_OUT = resolve(PROJECT_ROOT, "public/health.json");

// Pinned @moonlight/ui tag. raw.githubusercontent.com serves CSS as
// text/plain with nosniff so browsers refuse @import of these URLs; we
// fetch + concatenate at build time and write the result to public/styles.css.
// Do not change without bumping the consumer-side deps explicitly.
const UI_LIB_TAG = "v0.3.1";
const UI_LIB_CSS_FILES = [
  "tokens/tokens.css",
  "base-styles/base-styles.css",
  "nav/nav.css",
  "stepper/stepper.css",
];
const APP_STYLES_SRC = resolve(SRC_DIR, "app-styles.css");
const STYLES_OUT = resolve(PROJECT_ROOT, "public/styles.css");

async function writeHealthJson(version: string): Promise<void> {
  const health = { status: "ok", service: "moonlight-pay", version };
  await Deno.writeTextFile(HEALTH_OUT, JSON.stringify(health) + "\n");
  console.log(`Built public/health.json (moonlight-pay ${version})`);
}

async function buildStyles(): Promise<void> {
  const parts: string[] = [];
  for (const path of UI_LIB_CSS_FILES) {
    const url =
      `https://raw.githubusercontent.com/Moonlight-Protocol/ui/${UI_LIB_TAG}/src/${path}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch ${url}: ${res.status} ${res.statusText}`,
      );
    }
    const body = await res.text();
    parts.push(`/* @moonlight/ui ${UI_LIB_TAG} — ${path} */\n${body}`);
  }
  const appStyles = await Deno.readTextFile(APP_STYLES_SRC);
  parts.push(`/* moonlight-pay app-styles */\n${appStyles}`);
  await Deno.writeTextFile(STYLES_OUT, parts.join("\n"));
  console.log(
    `Built public/styles.css from @moonlight/ui@${UI_LIB_TAG} + src/app-styles.css`,
  );
}

const isProduction = Deno.args.includes("--production");
const denoJson = JSON.parse(await Deno.readTextFile(DENO_JSON));
const version = denoJson.version ?? "0.0.0";

await writeHealthJson(version);

await buildStyles();

await esbuild.build({
  entryPoints: [ENTRY_POINT],
  bundle: true,
  outfile: OUTFILE,
  format: "esm",
  platform: "browser",
  target: "es2022",
  supported: { decorators: false },
  minify: isProduction,
  sourcemap: true,
  define: {
    "__APP_VERSION__": JSON.stringify(version),
    "__DEV_MODE__": JSON.stringify(!isProduction),
  },
  inject: [BUFFER_SHIM],
  treeShaking: false,
  plugins: [
    // Resolve every bare/node: buffer import to the bundled npm buffer
    // package so nothing stays external. Without this, esbuild leaves
    // `import ... from "buffer"` statements in the output (unresolvable in
    // browsers), which the old post-build regex patches tried to repair —
    // fragile against minification and hoisting order.
    {
      name: "buffer-resolve",
      setup(build: esbuild.PluginBuild) {
        // realPath through the node_modules symlink into the .deno store so
        // the package's own deps (base64-js, ieee754) resolve as siblings.
        const bufferEntry = Deno.realPathSync(resolve(
          PROJECT_ROOT,
          "node_modules/buffer/index.js",
        ));
        build.onResolve({ filter: /^(node:)?buffer$/ }, () => ({
          path: bufferEntry,
        }));
      },
    },
    // Deduplicate @stellar/stellar-base — JSR and npm deps resolve separate
    // copies, each creating their own XDR type registry. XDR union identity
    // checks fail across copies ("Bad union switch: [object Object]").
    // This plugin forces all resolves to the single npm copy.
    // Deduplicate stellar XDR types. The bundle ends up with two copies
    // of js-xdr's Union class when both stellar-sdk's minified dist bundle
    // (which inlines stellar-base) AND the lib modules (which import
    // stellar-base separately) are included. XDR enum identity checks fail
    // across copies → "Bad union switch: [object Object]".
    //
    // Fix: intercept any resolve to stellar-sdk's dist bundles and redirect
    // to lib/index.js, ensuring only one copy of stellar-base is used.
    {
      name: "stellar-sdk-dedup",
      setup(build: esbuild.PluginBuild) {
        const sdkLib = resolve(
          PROJECT_ROOT,
          "node_modules/.deno/@stellar+stellar-sdk@15.1.0/node_modules/@stellar/stellar-sdk/lib/index.js",
        );
        // Catch any path that resolves to a dist/ bundle
        build.onLoad(
          { filter: /stellar-sdk[/\\]dist[/\\]/ },
          () => {
            // Replace the dist bundle content with a re-export of lib/index.js
            return {
              contents: `export * from ${JSON.stringify(sdkLib)};`,
              loader: "js",
            };
          },
        );
      },
    },
    // deno-lint-ignore no-explicit-any
    ...(denoPlugins({ configPath: DENO_JSON }) as any[]),
  ],
});

// ─── Post-build patches ────────────────────────────────────────
let appJs = await Deno.readTextFile(OUTFILE);

// 1. Patch __require: intercept require("buffer") before it throws.
// With nodeModulesDir, esbuild resolves CJS require("buffer") from
// node_modules/ directly — the "Dynamic require" error pattern may not
// exist. The patch is best-effort; skip if the pattern isn't found.
appJs = appJs.replace(
  /throw\s*(Error\('Dynamic require of "'\s*\+\s*(\w+)\s*\+\s*'" is not supported'\))/,
  (_match, errExpr, varName) =>
    `if(${varName}==="buffer")return globalThis.__buffer_polyfill;throw ${errExpr}`,
);

// 2. Replace node:crypto import with Web Crypto shim
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
