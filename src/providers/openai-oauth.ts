import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE = "https://auth.openai.com";
const USERCODE_URL = `${AUTH_BASE}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE}/api/accounts/deviceauth/token`;
const OAUTH_TOKEN_URL = `${AUTH_BASE}/oauth/token`;
const REDIRECT_URI = `${AUTH_BASE}/deviceauth/callback`;
export const VERIFICATION_URL = "https://auth.openai.com/codex/device";

const AUTH_DIR = join(homedir(), ".chris-assistant");
const TOKEN_FILE = join(AUTH_DIR, "openai-auth.json");

/** Margin in seconds before we consider a token expired */
const EXPIRY_MARGIN = 300; // 5 minutes — refresh early
const POLL_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires: number; // unix timestamp (milliseconds)
}

interface DeviceCodeResponse {
  device_auth_id: string;
  user_code: string;
  interval: number; // seconds
}

interface DeviceAuthResult {
  authorization_code: string;
  code_verifier: string;
}

// --- Step 1: Request user code ---

export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const res = await fetch(USERCODE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to request device code (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (!data.device_auth_id || !data.user_code) {
    throw new Error("OpenAI returned incomplete device code response");
  }

  return {
    device_auth_id: data.device_auth_id,
    user_code: data.user_code || data.usercode,
    interval: Number(data.interval) || 5,
  };
}

// --- Step 2: Poll for authorization code ---

export async function pollForAuthCode(
  deviceAuthId: string,
  userCode: string,
  interval: number,
): Promise<DeviceAuthResult> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  const pollIntervalMs = Math.max(interval, 5) * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));

    const res = await fetch(DEVICE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        device_auth_id: deviceAuthId,
        user_code: userCode,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.authorization_code && data.code_verifier) {
        return {
          authorization_code: data.authorization_code,
          code_verifier: data.code_verifier,
        };
      }
    }

    // 403 or 404 = still pending, keep polling
    if (res.status === 403 || res.status === 404) {
      continue;
    }

    // Any other error is fatal
    const text = await res.text();
    throw new Error(`Device auth poll failed (${res.status}): ${text}`);
  }

  throw new Error("Device code expired (15 min timeout) — please try again");
}

// --- Step 3: Exchange authorization code for tokens ---

export async function exchangeForTokens(
  authCode: string,
  codeVerifier: string,
): Promise<TokenData> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code: authCode,
    code_verifier: codeVerifier,
    redirect_uri: REDIRECT_URI,
  });

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (!data.access_token || !data.refresh_token) {
    throw new Error("OpenAI returned incomplete token response");
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

// --- Token refresh ---

async function refreshAccessToken(refreshToken: string): Promise<TokenData> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

// --- Token persistence ---

export function loadTokens(): TokenData | null {
  if (!existsSync(TOKEN_FILE)) return null;
  try {
    const raw = readFileSync(TOKEN_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (data.access_token && data.refresh_token && data.expires) {
      return data as TokenData;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: TokenData): void {
  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true });
  }
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2) + "\n", {
    mode: 0o600,
  });
}

// --- Main accessor ---

export async function getValidAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens) {
    throw new Error(
      'OpenAI OAuth tokens not found. Run "chris openai login" to authenticate.',
    );
  }

  const now = Date.now();
  if (now < tokens.expires - EXPIRY_MARGIN * 1000) {
    return tokens.access_token;
  }

  // Token expired or expiring soon — try refresh
  try {
    console.log("[openai] Refreshing access token...");
    const refreshed = await refreshAccessToken(tokens.refresh_token);
    saveTokens(refreshed);
    return refreshed.access_token;
  } catch (err: any) {
    throw new Error(
      `OpenAI token refresh failed: ${err.message}. Run "chris openai login" to re-authenticate.`,
    );
  }
}
