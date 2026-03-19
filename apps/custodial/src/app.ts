import { route, startRouter, navigate } from "./lib/router.ts";
import { isAuthenticated } from "./lib/auth.ts";
import { initAnalytics } from "shared/analytics/index.ts";
import { configure } from "shared/api/client.ts";
import { IS_PRODUCTION, POSTHOG_KEY, POSTHOG_HOST, API_BASE_URL } from "./lib/config.ts";

import { loginView } from "./views/login.ts";
import { dashboardView } from "./views/dashboard.ts";
import { sendView } from "./views/send.ts";
import { transactionsView } from "./views/transactions.ts";
import { demoView } from "./views/demo.ts";
import { reportView } from "./views/report.ts";

configure({ baseUrl: API_BASE_URL });
initAnalytics({
  isProduction: IS_PRODUCTION,
  posthogKey: POSTHOG_KEY,
  posthogHost: POSTHOG_HOST,
  appName: "moonlight-pay-custodial",
});

route("/login", loginView);
route("/dashboard", dashboardView);
route("/send", sendView);
route("/transactions", transactionsView);
route("/demo", demoView);
route("/report", reportView);

route("/", () => {
  if (isAuthenticated()) {
    navigate("/dashboard");
  } else {
    navigate("/login");
  }
  return document.createElement("div");
});

route("/404", () => {
  const el = document.createElement("div");
  el.className = "login-container";
  el.innerHTML = `<div class="login-card"><h1>404</h1><p>Page not found.</p><a href="#/dashboard">Back to dashboard</a></div>`;
  return el;
});

startRouter();
