/**
 * PostHog analytics wrapper.
 * NOOP in development, real tracking in production.
 * Supports autocapture_exceptions for error tracking.
 */

import posthog from "posthog-js";

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

  posthog.init(config.posthogKey, {
    api_host: config.posthogHost,
    person_profiles: "identified_only",
    autocapture: false,
    capture_pageview: true,
    capture_pageleave: true,
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

export function capture(event: string, properties?: Record<string, unknown>): void {
  analytics.capture(event, properties);
}

export function identify(distinctId: string, properties?: Record<string, unknown>): void {
  analytics.identify(distinctId, properties);
}

export function resetAnalytics(): void {
  analytics.reset();
}
