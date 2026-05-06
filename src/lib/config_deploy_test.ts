/**
 * Invariant test: every key declared on `PayConfig` must be written by the
 * deploy workflow — unless it appears in an explicit "default-only" allowlist
 * below. Catches the orphan-read class of bug, where source reads `cfg.X` but
 * the deploy workflow never writes X (so the feature is silently dead in
 * production). The bug that motivated this test: `adminWallets` had been
 * read by `isAdmin()` since the admin route shipped, but the deploy.yml
 * never wrote it, so the admin route was unreachable on every deploy.
 */
import { assertEquals } from "@std/assert";

const HERE = new URL(".", import.meta.url);
const CONFIG_TS = await Deno.readTextFile(new URL("./config.ts", HERE));
const DEPLOY_YML = await Deno.readTextFile(
  new URL("../../.github/workflows/deploy.yml", HERE),
);

// Keys declared on `PayConfig` that may legitimately be omitted from a
// deploy heredoc because the source-side default is correct for that
// network. Adding a key here is a deliberate "yes, the default is right"
// decision — the test will fail if you add a new PayConfig key and forget
// to either wire it through deploy.yml or list it here.
const DEFAULT_OK: Record<"testnet" | "mainnet", Set<string>> = {
  testnet: new Set(["rpcUrl"]),
  mainnet: new Set(),
};

function extractPayConfigKeys(src: string): Set<string> {
  const m = src.match(/export interface PayConfig\s*\{([\s\S]*?)\}/);
  if (!m) {
    throw new Error(
      "Could not locate `export interface PayConfig` in config.ts",
    );
  }
  return new Set(
    [...m[1].matchAll(/^\s*(\w+)\??:/gm)].map((x) => x[1]),
  );
}

function extractHeredocKeys(yml: string, header: string): Set<string> {
  const start = yml.indexOf(header);
  if (start < 0) throw new Error(`Could not find heredoc header: ${header}`);
  const end = yml.indexOf("Build production bundle", start);
  if (end < 0) {
    throw new Error(`Could not find end-of-heredoc after: ${header}`);
  }
  const block = yml.slice(start, end);
  return new Set(
    [...block.matchAll(/^\s*(\w+):/gm)]
      .map((x) => x[1])
      // Strip YAML step keys ("name", "run") that aren't config keys.
      .filter((k) => k !== "name" && k !== "run"),
  );
}

Deno.test("deploy.yml writes every PayConfig key on testnet (or it's in DEFAULT_OK)", () => {
  const declared = extractPayConfigKeys(CONFIG_TS);
  const written = extractHeredocKeys(DEPLOY_YML, "Generate production config");
  const missing = [...declared].filter(
    (k) => !written.has(k) && !DEFAULT_OK.testnet.has(k),
  );
  assertEquals(
    missing,
    [],
    `PayConfig keys read by source but not written by testnet deploy heredoc: ${
      missing.join(", ")
    }. ` +
      `Wire them through deploy.yml, or — only if the source-side default is intentionally correct ` +
      `for testnet — add them to DEFAULT_OK.testnet in this file.`,
  );
});

Deno.test("deploy.yml writes every PayConfig key on mainnet (or it's in DEFAULT_OK)", () => {
  const declared = extractPayConfigKeys(CONFIG_TS);
  const written = extractHeredocKeys(DEPLOY_YML, "Generate mainnet config");
  const missing = [...declared].filter(
    (k) => !written.has(k) && !DEFAULT_OK.mainnet.has(k),
  );
  assertEquals(
    missing,
    [],
    `PayConfig keys read by source but not written by mainnet deploy heredoc: ${
      missing.join(", ")
    }. ` +
      `Wire them through deploy.yml, or — only if the source-side default is intentionally correct ` +
      `for mainnet — add them to DEFAULT_OK.mainnet in this file.`,
  );
});
