/**
 * End-to-end test of the backend Firebase login WITHOUT the mobile app.
 *
 * It mints a genuine Firebase ID token server-side (create/find a Firebase user
 * with a phone → custom token → exchange for an ID token via the Identity
 * Toolkit REST API), then posts it to POST /auth/firebase exactly like the app
 * would, and finally calls GET /me with the returned session.
 *
 * Usage: node scripts/test-firebase-login.js [phone] [apiKey]
 *   phone  defaults to +919000000001 (seeded manager Anita)
 */
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const SERVICE_ACCOUNT = require('../secrets/firebase-service-account.json');
const PHONE = process.argv[2] || '+919000000001';
const WEB_API_KEY = process.argv[3] || process.env.FIREBASE_WEB_API_KEY;
const BACKEND = process.env.BACKEND_URL || 'http://localhost:4000';

if (!WEB_API_KEY) {
  console.error('Missing Web API key. Pass it as argv[2] or FIREBASE_WEB_API_KEY.');
  process.exit(1);
}

async function main() {
  const app = initializeApp({ credential: cert(SERVICE_ACCOUNT) });
  const auth = getAuth(app);

  // 1. Ensure a Firebase user exists with this phone number.
  let user;
  try {
    user = await auth.getUserByPhoneNumber(PHONE);
    console.log('1. Found existing Firebase user:', user.uid);
  } catch {
    user = await auth.createUser({ phoneNumber: PHONE });
    console.log('1. Created Firebase user:', user.uid);
  }

  // 2. Mint a custom token, exchange it for a real ID token via REST.
  const customToken = await auth.createCustomToken(user.uid);
  const exchange = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const exchangeJson = await exchange.json();
  if (!exchangeJson.idToken) throw new Error('Token exchange failed: ' + JSON.stringify(exchangeJson));
  const idToken = exchangeJson.idToken;
  console.log('2. Got Firebase ID token (length ' + idToken.length + ')');

  // Sanity: show the phone claim our backend will read.
  const decoded = await auth.verifyIdToken(idToken);
  console.log('   decoded phone_number:', decoded.phone_number ?? '(none!)');

  // 3. Hit our backend like the app does.
  const loginRes = await fetch(`${BACKEND}/auth/firebase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, shopId: 'shop_pitstop_hsr' }),
  });
  const session = await loginRes.json();
  console.log('3. POST /auth/firebase ->', loginRes.status, JSON.stringify(session).slice(0, 120));
  if (!session.accessToken) throw new Error('No accessToken in response');

  // 4. Call /me with the session.
  const meRes = await fetch(`${BACKEND}/me`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  const me = await meRes.json();
  console.log('4. GET /me ->', meRes.status, JSON.stringify(me));

  console.log('\n✅ Backend Firebase login works end-to-end.');
  process.exit(0);
}

main().catch((e) => {
  console.error('\n❌ Test failed:', e.message);
  process.exit(1);
});
