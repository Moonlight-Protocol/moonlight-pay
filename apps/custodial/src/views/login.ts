import { isAuthenticated, login, register } from "../lib/auth.ts";
import { navigate } from "../lib/router.ts";
import { configure } from "shared/api/client.ts";
import { identify, capture } from "shared/analytics/index.ts";
import { API_BASE_URL } from "../lib/config.ts";

export function loginView(): HTMLElement {
  if (isAuthenticated()) {
    navigate("/dashboard");
    return document.createElement("div");
  }

  const container = document.createElement("div");
  container.className = "login-container";
  container.innerHTML = `
    <div class="login-card">
      <h1>Moonlight Pay</h1>
      <p>Custodial private payments on Stellar.</p>
      <p style="color:var(--text-muted);font-size:0.875rem;margin-bottom:1.5rem">
        No wallet needed. Create an account or sign in to get started.
        Your funds are managed by the Privacy Provider.
      </p>

      <div class="form-group">
        <label for="username">Username</label>
        <input type="text" id="username" placeholder="username" autocomplete="username" />
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" placeholder="password" autocomplete="current-password" />
      </div>

      <div style="display:flex;gap:0.5rem;margin-top:1rem">
        <button id="login-btn" class="btn-primary" style="flex:1">Sign In</button>
        <button id="register-btn" class="btn-primary" style="flex:1;background:var(--border)">Register</button>
      </div>

      <p id="login-status" class="hint-text" hidden></p>
      <p id="login-error" class="error-text" hidden></p>
    </div>
  `;

  const usernameEl = container.querySelector("#username") as HTMLInputElement;
  const passwordEl = container.querySelector("#password") as HTMLInputElement;
  const loginBtn = container.querySelector("#login-btn") as HTMLButtonElement;
  const registerBtn = container.querySelector("#register-btn") as HTMLButtonElement;
  const statusEl = container.querySelector("#login-status") as HTMLParagraphElement;
  const errorEl = container.querySelector("#login-error") as HTMLParagraphElement;

  function getCredentials(): { user: string; pass: string } | null {
    const user = usernameEl.value.trim();
    const pass = passwordEl.value;
    if (!user || !pass) {
      errorEl.textContent = "Username and password required";
      errorEl.hidden = false;
      return null;
    }
    return { user, pass };
  }

  loginBtn.addEventListener("click", async () => {
    const creds = getCredentials();
    if (!creds) return;

    loginBtn.disabled = registerBtn.disabled = true;
    errorEl.hidden = true;
    statusEl.textContent = "Signing in...";
    statusEl.hidden = false;

    try {
      configure({ baseUrl: API_BASE_URL });
      await login(creds.user, creds.pass);

      identify(creds.user);
      capture("pay_custodial_login");
      passwordEl.value = "";
      navigate("/dashboard");
    } catch (error) {
      errorEl.textContent = error instanceof Error ? error.message : "Login failed";
      errorEl.hidden = false;
      statusEl.hidden = true;
    } finally {
      loginBtn.disabled = registerBtn.disabled = false;
    }
  });

  registerBtn.addEventListener("click", async () => {
    const creds = getCredentials();
    if (!creds) return;

    loginBtn.disabled = registerBtn.disabled = true;
    errorEl.hidden = true;
    statusEl.textContent = "Creating account...";
    statusEl.hidden = false;

    try {
      configure({ baseUrl: API_BASE_URL });
      const { depositAddress } = await register(creds.user, creds.pass);

      identify(creds.user);
      capture("pay_custodial_register", { depositAddress: depositAddress.slice(0, 8) });
      passwordEl.value = "";
      navigate("/dashboard");
    } catch (error) {
      errorEl.textContent = error instanceof Error ? error.message : "Registration failed";
      errorEl.hidden = false;
      statusEl.hidden = true;
    } finally {
      loginBtn.disabled = registerBtn.disabled = false;
    }
  });

  // Enter key on password field
  passwordEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loginBtn.click();
  });

  return container;
}
