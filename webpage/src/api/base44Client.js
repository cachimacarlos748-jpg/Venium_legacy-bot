import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

// Create a client with authentication required.
// serverUrl MUST point to the Base44 backend. Leaving it empty makes the SDK
// build URLs relative to the current origin, so every API call (and the
// realtime socket) hits our own domain and returns 405/HTML instead of data.
export const base44 = createClient({
  appId,
  token,
  functionsVersion,
  serverUrl: import.meta.env.VITE_BASE44_SERVER_URL || 'https://base44.app',
  requiresAuth: false,
  appBaseUrl
});
