import { navigate, route, routePrefix, startRouter } from "./lib/router.ts";
import { isAuthenticated, isMasterSeedReady } from "./lib/wallet.ts";
import { isPlatformAuthed } from "./lib/api.ts";

import { loginView } from "./views/login.ts";
import { homeView } from "./views/home.ts";
import { posView } from "./views/pos.ts";
import { adminView } from "./views/admin.ts";
import { accountView } from "./views/onboarding/account.ts";
import { treasuryView } from "./views/onboarding/treasury.ts";

route("/login", loginView);
route("/", homeView);
route("/admin", adminView);
route("/onboarding/account", accountView);
route("/onboarding/treasury", treasuryView);
routePrefix("/pay/", posView);

route("/404", () => {
  const el = document.createElement("div");
  el.className = "login-container";
  el.innerHTML =
    `<div class="login-card"><h1>404</h1><p>Page not found.</p><a href="#/">Back</a></div>`;
  return el;
});

// Default landing — if fully authed, go home; otherwise login
if (!globalThis.location.hash || globalThis.location.hash === "#/") {
  if (!isAuthenticated() || !isMasterSeedReady() || !isPlatformAuthed()) {
    navigate("/login");
  }
}

startRouter();
