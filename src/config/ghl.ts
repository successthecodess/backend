import { getSecrets } from './secrets.js';

export async function getGHLConfig() {
  const secrets = await getSecrets();
  
  return {
    clientId: secrets.GHL_CLIENT_ID,
    clientSecret: secrets.GHL_CLIENT_SECRET,
    redirectUri: process.env.GHL_REDIRECT_URI!,
  };
}