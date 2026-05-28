/**
 * PostHog error-tracking wrapper.
 *
 * Reads its own slice of `window.__PAY_CONFIG__` directly so a missing/partial
 * config can NOOP cleanly without triggering the fail-fast throw that
 * `config.ts`'s typed getters use for app-critical values.
 */
import type { PayConfig } from "./config.ts";

interface Analytics {
  captureException(error: unknown, properties?: Record<string, unknown>): void;
}

const noop: Analytics = {
  captureException() {},
};

let analytics: Analytics = noop;

function readWindowConfig(): PayConfig | undefined {
  // deno-lint-ignore no-explicit-any
  const w = (globalThis as any).window;
  return w?.__PAY_CONFIG__;
}

export function initAnalytics(): void {
  const cfg = readWindowConfig() ?? {};
  const isProduction = (cfg.environment ?? "production") === "production";
  const posthogKey = cfg.posthogKey ?? "";
  const posthogHost = cfg.posthogHost ?? "https://us.i.posthog.com";

  if (!isProduction || !posthogKey) {
    return;
  }

  const script = document.createElement("script");
  script.src = "https://us-assets.i.posthog.com/static/array.js";
  script.onload = () => {
    // deno-lint-ignore no-explicit-any
    const posthog = (window as any).posthog;
    if (posthog) {
      posthog.init(posthogKey, {
        api_host: posthogHost,
        capture_exceptions: true,
        person_profiles: "identified_only",
      });
      analytics = {
        captureException: (error, properties) =>
          posthog.captureException(error, properties),
      };
    }
  };
  document.head.appendChild(script);
}

export function captureException(
  error: unknown,
  properties?: Record<string, unknown>,
): void {
  analytics.captureException(error, properties);
}
