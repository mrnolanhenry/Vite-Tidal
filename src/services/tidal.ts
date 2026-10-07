import { createAPIClient } from '@tidal-music/api';
// CredentialsProvider or standard OAuth authentication fetch configurations
// can be set up depending on your architecture (Client Credentials vs Authorization Code with PKCE).

const clientId = import.meta.env.VITE_TIDAL_CLIENT_ID;
const clientSecret = import.meta.env.VITE_TIDAL_CLIENT_SECRET;

/**
 * Example function fetching a client token via Client Credentials flow.
 * Note: If performing client-credentials server-to-server calls, 
 * it is recommended to do this on a backend to avoid leaking the Client Secret.
 */
async function getClientCredentialsToken(): Promise<string> {
  const response = await fetch('https://auth.tidal.com/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`clientId:{clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
    }),
  });

  const data = await response.json();
  return data.access_token;
}

// Initialize the API client
export const initTidalClient = async () => {
  const token = await getClientCredentialsToken();

  // Provide your configuration or pass standard fetch wrappers
  // depending on the requirements of @tidal-music/api
  return createAPIClient(
    credentialsProvider
  );
};
