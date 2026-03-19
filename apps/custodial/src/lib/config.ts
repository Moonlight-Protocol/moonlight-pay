declare global {
  interface Window {
    __PAY_CONFIG__?: {
      environment?: string;
      apiBaseUrl?: string;
      posthogKey?: string;
      posthogHost?: string;
    };
  }
}

const config = window.__PAY_CONFIG__ ?? {};

export const ENVIRONMENT = config.environment ?? "development";
export const IS_PRODUCTION = ENVIRONMENT === "production";
export const API_BASE_URL = config.apiBaseUrl ?? "http://localhost:3000/api/v1";
export const POSTHOG_KEY = config.posthogKey ?? "";
export const POSTHOG_HOST = config.posthogHost ?? "https://us.i.posthog.com";
