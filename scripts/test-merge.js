/**
 * End-to-end test of account linking + merge.
 *
 * Creates account A (phone) and account B (phone) with owned data, then links B
 * into A and asserts: B's data moved to A, both login methods now on A, B's user
 * is gone, and logging in with B's phone resolves to A (no duplicate).
 *
 * Usage: node scripts/test-merge.js <webApiKey>
 */
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { PrismaClient } = require('@prisma/client');

const SA = require('../secrets/firebase-service-account.json');
const KEY = process.argv[2] || process.env.FIREBASE_WEB_API_KEY;
const BACKEND = 'http://localhost:4000';
const PHONE_A = '+919000111111';
const PHONE_B = '+919000222222';

const app = initializeApp({ credential: cert(SA) });
const auth = getAuth(app);
const prisma = new PrismaClient();

async function mintToken(phone) {
  let user;
  try { user = await auth.getUserByPhoneNumber(phone); }
  catch { user = await auth.createUser({ phoneNumber: phone }); }
  const custom = await auth.createCustomToken(user.uid);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }) },
  );
  const j = await res.json();
  if (!j.idToken) throw new Error('mint failed: ' + JSON.stringify(j));
  return j.idToken;
}

async function login(idToken) {
  const r = await fetch(`${BACKEND}/auth/firebase`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) });
  const tokens = await r.json();
  const me = await (await fetch(`${BACKEND}/me`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } })).json();
  return { tokens, me };
}

function assert(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); console.log('  ✓ ' + msg); }

async function main() {
  // Clean any prior run.
  await prisma.user.deleteMany({ where: { phone: { in: [PHONE_A, PHONE_B] } } });

  console.log('1. Create account A (phone) + account B (phone)');
  const A = await login(await mintToken(PHONE_A));
  const B = await login(await mintToken(PHONE_B));
  const userA = A.me.user.id, userB = B.me.user.id;
  assert(userA !== userB, 'A and B start as separate accounts');

  console.log('2. Give B a vehicle (owned data that must survive the merge)');
  const bMembership = await prisma.membership.findFirstOrThrow({ where: { userId: userB, role: 'CUSTOMER' } });
  const vehicle = await prisma.vehicle.create({ data: { membershipId: bMembership.id, makeModel: 'Test Car B', plate: 'KA01B0001' } });

  console.log('3a. Link B WITHOUT confirm → should report merge_required, NOT merge');
  const tokenB = await mintToken(PHONE_B);
  const link = (body) => fetch(`${BACKEND}/auth/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${A.tokens.accessToken}` },
    body: JSON.stringify(body),
  }).then((r) => r.json());

  const preview = await link({ idToken: tokenB });
  assert(preview.status === 'merge_required', `first link returns merge_required (got ${preview.status})`);
  assert(preview.conflict.vehicles === 1, `reports B's 1 vehicle (got ${preview.conflict.vehicles})`);
  const stillThere = await prisma.user.findUnique({ where: { id: userB } });
  assert(stillThere !== null, 'B is NOT merged yet (still exists)');

  console.log('3b. Confirm the merge');
  const merged = await link({ idToken: tokenB, confirmMerge: true });
  assert(merged.status === 'merged', `confirm returns merged (got ${merged.status})`);

  console.log('4. Verify the merge');
  const meA = await (await fetch(`${BACKEND}/me`, { headers: { Authorization: `Bearer ${A.tokens.accessToken}` } })).json();
  const providers = meA.loginMethods.map((m) => m.phone).sort();
  assert(providers.includes(PHONE_A) && providers.includes(PHONE_B), 'A now has BOTH phone login methods');

  const movedVehicle = await prisma.vehicle.findUnique({ where: { id: vehicle.id }, include: { membership: true } });
  assert(movedVehicle && movedVehicle.membership.userId === userA, "B's vehicle moved to A (no data lost)");

  const bGone = await prisma.user.findUnique({ where: { id: userB } });
  assert(bGone === null, 'B account deleted (no duplicate)');

  const reB = await login(await mintToken(PHONE_B));
  assert(reB.me.user.id === userA, "logging in with B's phone now resolves to A (no new duplicate)");

  console.log('\n✅ Merge works: data preserved, accounts unified, no duplicates.');
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error('\n❌ ' + e.message); await prisma.$disconnect(); process.exit(1); });
