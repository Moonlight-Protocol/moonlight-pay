/**
 * Username/password auth for custodial app.
 * No wallet needed — PP controls everything.
 */
import { custodialLogin, custodialRegister, setAuthToken } from "shared/api/client.ts";

const TOKEN_KEY = "moonlight_pay_custodial_token";
const USER_KEY = "moonlight_pay_custodial_user";

let authToken: string | null = null;
let username: string | null = null;

export function getToken(): string | null {
  if (!authToken) {
    authToken = localStorage.getItem(TOKEN_KEY);
  }
  return authToken;
}

export function getUsername(): string | null {
  if (!username) {
    username = localStorage.getItem(USER_KEY);
  }
  return username;
}

export function isAuthenticated(): boolean {
  const token = getToken();
  if (!token) return false;
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64));
    if (typeof payload.exp === "number" && Date.now() / 1000 > payload.exp) {
      clearSession();
      return false;
    }
  } catch {
    clearSession();
    return false;
  }
  return true;
}

export function clearSession(): void {
  authToken = null;
  username = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  setAuthToken(null);
}

function storeSession(user: string, token: string): void {
  authToken = token;
  username = user;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, user);
  setAuthToken(token);
}

export async function login(user: string, password: string): Promise<string> {
  const { data } = await custodialLogin(user, password);
  storeSession(user, data.token);
  return data.token;
}

export async function register(user: string, password: string): Promise<{ token: string; depositAddress: string }> {
  const { data } = await custodialRegister(user, password);
  storeSession(user, data.token);
  return data;
}
