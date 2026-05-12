import { clearSession } from "./wallet.ts";
import { clearPlatformAuth } from "./api.ts";
import { navigate } from "./router.ts";

/**
 * Moonlight-pay logout side effects. Centralised here so the nav's
 * onLogout callback (set up in the page wrappers) uses the same teardown
 * sequence.
 */
export function logout(): void {
  clearSession();
  clearPlatformAuth();
  navigate("/login");
}
