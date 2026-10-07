const AUTH_URL = "https://login.tidal.com/authorize";
const TOKEN_URL = "https://auth.tidal.com/v1/oauth2/token";

const clientId = import.meta.env.VITE_TIDAL_CLIENT_ID;
const redirectUri = import.meta.env.VITE_TIDAL_REDIRECT_URI;
const scopes = import.meta.env.VITE_TIDAL_SCOPES ?? "user.read";

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function randomString(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function challengeFor(verifier: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return b64url(digest);
}

export async function login() {
  const verifier = randomString(64);
  const state = randomString(16);
  sessionStorage.setItem("pkce_verifier", verifier);
  sessionStorage.setItem("pkce_state", state);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    code_challenge_method: "S256",
    code_challenge: await challengeFor(verifier),
    state,
  });
  window.location.assign(`${AUTH_URL}?${params}`);
}

/** Call once on page load; completes login if redirected back with ?code= */
export async function handleRedirect(): Promise<void> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (!code) return;

  const state = url.searchParams.get("state");
  const verifier = sessionStorage.getItem("pkce_verifier");
  if (state !== sessionStorage.getItem("pkce_state") || !verifier) {
    throw new Error("OAuth state mismatch");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);

  const json = await res.json();
  sessionStorage.setItem("access_token", json.access_token);
  sessionStorage.removeItem("pkce_verifier");
  sessionStorage.removeItem("pkce_state");
  window.history.replaceState({}, "", redirectUri);
}

export const getToken = () => sessionStorage.getItem("access_token");

export function logout() {
  sessionStorage.removeItem("access_token");
  window.location.reload();
}