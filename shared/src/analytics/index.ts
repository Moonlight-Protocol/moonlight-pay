/**
 * PostHog analytics wrapper.
 * NOOP in development, real tracking in production.
 * Supports autocapture_exceptions for error tracking.
 */

interface Analytics {
  capture(event: string, properties?: Record<string, unknown>): void;
  identify(distinctId: string, properties?: Record<string, unknown>): void;
  reset(): void;
}

const noop: Analytics = {
  capture() {},
  identify() {},
  reset() {},
};

let analytics: Analytics = noop;

export function initAnalytics(config: {
  isProduction: boolean;
  posthogKey: string;
  posthogHost: string;
  appName: string;
}): void {
  if (!config.isProduction || !config.posthogKey) return;

  const script = document.createElement("script");
  script.src = "https://us-assets.i.posthog.com/static/array.js";
  script.crossOrigin = "anonymous";
  // TODO: Generate SRI integrity hash for PostHog array.js at build time.
  // The CDN-hosted script changes on updates, so the hash must be regenerated
  // whenever the PostHog JS version is bumped.
  script.onload = () => {
    // deno-lint-ignore no-explicit-any
    const posthog = (window as any).posthog;
    if (posthog) {
      posthog.init(config.posthogKey, {
        api_host: config.posthogHost,
        person_profiles: "identified_only",
        autocapture: false,
        capture_pageview: true,
        capture_pageleave: true,
        // Error tracking
        autocapture_exceptions: true,
        loaded: () => {
          posthog.register({ app: config.appName });
        },
      });

      analytics = {
        capture: (event, properties) => posthog.capture(event, properties),
        identify: (distinctId, properties) => posthog.identify(distinctId, properties),
        reset: () => posthog.reset(),
      };
    }
  };
  document.head.appendChild(script);
}

export function capture(event: string, properties?: Record<string, unknown>): void {
  analytics.capture(event, properties);
}

export function identify(distinctId: string, properties?: Record<string, unknown>): void {
  analytics.identify(distinctId, properties);
}

export function resetAnalytics(): void {
  analytics.reset();
}
