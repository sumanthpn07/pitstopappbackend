/**
 * Tests POST /auth/unlink: removing a login method works, and removing the LAST
 * one is blocked. Usage: node scripts/test-unlink.js <webApiKey>
 */
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { PrismaClient } = require('@prisma/client');

const SA = require('../secrets/firebase-service-account.json');
const KEY = process.argv[2] || process.env.FIREBASE_WEB_API_KEY;
const BACKEND = 'http://localhost:4000';
const PHONE = '+919000333333';

const app = initializeApp({ credential: cert(SA) });
const auth = getAuth(app);
const prisma = new PrismaClient();

async function mintToken(phone) {
  let u; try { u = await auth.getUserByPhoneNumber(phone); } catch { u = await auth.createUser({ phoneNumber: phone }); }
  const custom = await auth.createCustomToken(u.uid);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }) });
  return (await r.json()).idToken;
}
function assert(c, m) { if (!c) throw new Error('FAILED: ' + m); console.log('  ✓ ' + m); }

async function main() {
  await prisma.user.deleteMany({ where: { phone: PHONE } });

  console.log('1. Login by phone (1 identity)');
  const tokens = await (await fetch(`${BACKEND}/auth/firebase`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: await mintToken(PHONE) }) })).json();
  const auth1 = { Authorization: `Bearer ${tokens.accessToken}` };
  const me1 = await (await fetch(`${BACKEND}/me`, { headers: auth1 })).json();
  const userId = me1.user.id;
  assert(me1.loginMethods.length === 1, 'starts with 1 login method (phone)');

  console.log('2. Add a GOOGLE identity directly (simulating a linked Google account)');
  await prisma.authIdentity.create({ data: { userId, provider: 'GOOGLE', subject: 'test-google-sub-123', emailSnapshot: 'tester@gmail.com' } });

  console.log('3. Remove Google');
  const rmGoogle = await fetch(`${BACKEND}/auth/unlink`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth1 }, body: JSON.stringify({ provider: 'GOOGLE' }) });
  assert(rmGoogle.status === 204, `unlink GOOGLE returned 204 (got ${rmGoogle.status})`);
  const meAfter = await (await fetch(`${BACKEND}/me`, { headers: auth1 })).json();
  assert(meAfter.loginMethods.length === 1 && meAfter.loginMethods[0].provider === 'PHONE', 'only PHONE remains');

  console.log('4. Try to remove the LAST method (phone) → should be blocked');
  const rmLast = await fetch(`${BACKEND}/auth/unlink`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth1 }, body: JSON.stringify({ provider: 'PHONE' }) });
  const body = await rmLast.json().catch(() => ({}));
  assert(rmLast.status === 400, `removing last method blocked with 400 (got ${rmLast.status})`);
  assert(/only login method/i.test(body?.error?.message ?? ''), 'returns a helpful "only login method" message');
  const meFinal = await (await fetch(`${BACKEND}/me`, { headers: auth1 })).json();
  assert(meFinal.loginMethods.length === 1, 'phone is still there (not removed)');

  console.log('\n✅ Remove (unlink) works, and the last method is protected.');
  await prisma.user.deleteMany({ where: { phone: PHONE } });
  await prisma.$disconnect();
  process.exit(0);
}
main().catch(async (e) => { console.error('\n❌ ' + e.message); await prisma.$disconnect(); process.exit(1); });
