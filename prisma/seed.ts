import {
  AuthProvider,
  BookingStatus,
  ConditionKind,
  PaymentStatus,
  PrismaClient,
  Role,
  TxnType,
  Weekday,
} from '@prisma/client';
import { DateTime } from 'luxon';
import { checklistFor } from '../src/domain/checklist-templates';

const prisma = new PrismaClient();

const SHOP_ID = 'shop_pitstop_hsr';
const ZONE = 'Asia/Kolkata';

function photo(id: string): string {
  return `https://images.unsplash.com/photo-${id}?w=900&q=80&auto=format&fit=crop`;
}
function pic(seed: string): string {
  return `https://picsum.photos/seed/${seed}/900/600`;
}
function at(dateKey: string, hhmm: string): Date {
  return DateTime.fromISO(`${dateKey}T${hhmm}`, { zone: ZONE }).toJSDate();
}

const SERVICES = [
  { id: 'svc_wash', name: 'Express Exterior Wash', description: 'A quick, thorough hand wash — wheels, body and glass. In and out in under an hour.', pricePaise: 49900, durationMin: 45, photo: photo('1520340356584-f9917d1eea6f'), icon: 'water', category: 'Wash' },
  { id: 'svc_foam', name: 'Premium Foam Wash & Wax', description: 'Snow-foam pre-soak, pH-neutral wash, hand dry and a carnauba wax for deep gloss.', pricePaise: 129900, durationMin: 90, photo: photo('1607860108855-64acf2078ed9'), icon: 'sparkles', category: 'Wash' },
  { id: 'svc_interior', name: 'Interior Deep Clean', description: 'Full vacuum, steam-clean of seats and mats, dashboard conditioning and odour removal.', pricePaise: 179900, durationMin: 120, photo: photo('1605437241278-c1806d14a4d9'), icon: 'car-sport', category: 'Detail' },
  { id: 'svc_full', name: 'Full Detailing — In & Out', description: 'The works: exterior foam wash, paint decontamination, interior deep clean and dressing.', pricePaise: 349900, durationMin: 240, photo: photo('1633014041037-f5446fb4ce99'), icon: 'brush', category: 'Detail' },
  { id: 'svc_ceramic', name: 'Ceramic Coating 9H', description: 'Multi-stage paint correction followed by a 9H ceramic coat. Years of gloss and protection.', pricePaise: 1499900, durationMin: 480, photo: photo('1622329821376-a19fd6002562'), icon: 'shield-checkmark', category: 'Protect' },
  { id: 'svc_headlight', name: 'Headlight Restoration', description: 'Sand, polish and seal cloudy headlights back to crystal clarity.', pricePaise: 89900, durationMin: 60, photo: photo('1556448851-9359658faa54'), icon: 'bulb', category: 'Detail' },
];
const SERVICE_BY_ID = Object.fromEntries(SERVICES.map((s) => [s.id, s]));

const WORKING_HOURS: Record<Weekday, { open: string; close: string; capacity: number; closed: boolean }> = {
  mon: { open: '09:00', close: '19:00', capacity: 3, closed: false },
  tue: { open: '09:00', close: '19:00', capacity: 3, closed: false },
  wed: { open: '09:00', close: '19:00', capacity: 3, closed: false },
  thu: { open: '09:00', close: '19:00', capacity: 3, closed: false },
  fri: { open: '09:00', close: '19:00', capacity: 3, closed: false },
  sat: { open: '09:00', close: '20:00', capacity: 4, closed: false },
  sun: { open: '10:00', close: '17:00', capacity: 2, closed: false },
};

// Staff sign in with these phone numbers (OTP shown in the API response in dev).
const STAFF = [
  { userId: 'usr_mgr_anita', membershipId: 'mem_mgr_anita', phone: '+919000000001', name: 'Anita Desai', role: Role.MANAGER },
  { userId: 'usr_emp_ravi', membershipId: 'mem_emp_ravi', phone: '+919000000002', name: 'Ravi Kumar', role: Role.EMPLOYEE },
  { userId: 'usr_emp_priya', membershipId: 'mem_emp_priya', phone: '+919000000003', name: 'Priya Nair', role: Role.EMPLOYEE },
];

const DEMO_CUSTOMER = { userId: 'usr_demo_aarav', membershipId: 'mem_demo_aarav', phone: '+919812300000', name: 'Aarav Sharma' };
const RAVI = 'mem_emp_ravi';
const PRIYA = 'mem_emp_priya';

function checklistCreate(serviceId: string, doneCount = 0) {
  const now = new Date();
  return checklistFor(serviceId).map((label, i) => ({
    label,
    position: i,
    done: i < doneCount,
    doneAt: i < doneCount ? now : null,
  }));
}

function reportCreate(kind: ConditionKind, verified: boolean, seeds: string[]) {
  return {
    kind,
    customerVerifiedAt: verified ? new Date() : null,
    photos: { create: seeds.map((s) => ({ url: pic(s), caption: null })) },
  };
}

async function main(): Promise<void> {
  // Shop
  await prisma.shop.upsert({
    where: { id: SHOP_ID },
    update: {},
    create: {
      id: SHOP_ID,
      name: 'PitStop Auto Spa',
      tagline: 'Premium car detailing • HSR Layout',
      address: '27th Main, HSR Layout Sector 2, Bengaluru 560102',
      lat: 12.9121,
      lng: 77.6446,
      timezone: ZONE,
      rating: 4.8,
      ratingCount: 326,
    },
  });

  // Working hours
  for (const day of Object.keys(WORKING_HOURS) as Weekday[]) {
    const h = WORKING_HOURS[day];
    await prisma.workingHour.upsert({
      where: { shopId_day: { shopId: SHOP_ID, day } },
      update: h,
      create: { shopId: SHOP_ID, day, ...h },
    });
  }

  // Services
  for (const s of SERVICES) {
    await prisma.service.upsert({
      where: { id: s.id },
      update: { name: s.name, description: s.description, pricePaise: s.pricePaise, durationMin: s.durationMin, photoUrl: s.photo, icon: s.icon, category: s.category, active: true },
      create: { id: s.id, shopId: SHOP_ID, name: s.name, description: s.description, pricePaise: s.pricePaise, durationMin: s.durationMin, photoUrl: s.photo, icon: s.icon, category: s.category, active: true },
    });
  }

  // Staff (manager + employees)
  for (const st of STAFF) {
    await prisma.user.upsert({
      where: { id: st.userId },
      update: { name: st.name, phone: st.phone },
      create: { id: st.userId, phone: st.phone, name: st.name },
    });
    await prisma.membership.upsert({
      where: { id: st.membershipId },
      update: {},
      create: { id: st.membershipId, userId: st.userId, shopId: SHOP_ID, role: st.role },
    });
    await prisma.authIdentity.upsert({
      where: { provider_subject: { provider: AuthProvider.PHONE, subject: st.phone } },
      update: { userId: st.userId, phoneSnapshot: st.phone },
      create: { userId: st.userId, provider: AuthProvider.PHONE, subject: st.phone, phoneSnapshot: st.phone },
    });
  }

  // Demo customer + vehicles
  await prisma.user.upsert({
    where: { id: DEMO_CUSTOMER.userId },
    update: { name: DEMO_CUSTOMER.name, phone: DEMO_CUSTOMER.phone },
    create: { id: DEMO_CUSTOMER.userId, phone: DEMO_CUSTOMER.phone, name: DEMO_CUSTOMER.name },
  });
  await prisma.membership.upsert({
    where: { id: DEMO_CUSTOMER.membershipId },
    update: {},
    create: { id: DEMO_CUSTOMER.membershipId, userId: DEMO_CUSTOMER.userId, shopId: SHOP_ID, role: Role.CUSTOMER },
  });
  await prisma.authIdentity.upsert({
    where: { provider_subject: { provider: AuthProvider.PHONE, subject: DEMO_CUSTOMER.phone } },
    update: { userId: DEMO_CUSTOMER.userId, phoneSnapshot: DEMO_CUSTOMER.phone },
    create: { userId: DEMO_CUSTOMER.userId, provider: AuthProvider.PHONE, subject: DEMO_CUSTOMER.phone, phoneSnapshot: DEMO_CUSTOMER.phone },
  });
  await prisma.vehicle.upsert({
    where: { id: 'veh_demo_swift' },
    update: { type: 'Car' },
    create: { id: 'veh_demo_swift', membershipId: DEMO_CUSTOMER.membershipId, makeModel: 'Maruti Swift', plate: 'KA 01 AB 1234', color: 'Pearl White', type: 'Car' },
  });
  await prisma.vehicle.upsert({
    where: { id: 'veh_demo_creta' },
    update: { type: 'Car' },
    create: { id: 'veh_demo_creta', membershipId: DEMO_CUSTOMER.membershipId, makeModel: 'Hyundai Creta', plate: 'KA 05 MJ 9090', color: 'Midnight Blue', type: 'Car' },
  });
  await prisma.vehicle.upsert({
    where: { id: 'veh_demo_classic' },
    update: { type: 'Bike' },
    create: { id: 'veh_demo_classic', membershipId: DEMO_CUSTOMER.membershipId, makeModel: 'Royal Enfield Classic 350', plate: 'KA 03 HG 4521', color: 'Jet Black', type: 'Bike' },
  });

  // Reset and reseed the demo customer's bookings (idempotent).
  await prisma.booking.deleteMany({ where: { customerMembershipId: DEMO_CUSTOMER.membershipId } });

  const todayKey = DateTime.now().setZone(ZONE).toISODate() as string;
  const tomorrowKey = DateTime.now().setZone(ZONE).plus({ days: 1 }).toISODate() as string;
  const pastKey = DateTime.now().setZone(ZONE).minus({ days: 8 }).toISODate() as string;

  const base = (serviceId: string) => {
    const svc = SERVICE_BY_ID[serviceId];
    return { serviceId, durationMin: svc.durationMin, pricePaise: svc.pricePaise };
  };

  // 1) Unassigned, upcoming — the manager assigns staff.
  await prisma.booking.create({
    data: {
      shopId: SHOP_ID, customerMembershipId: DEMO_CUSTOMER.membershipId, vehicleId: 'veh_demo_creta',
      status: BookingStatus.BOOKED, scheduledAt: at(tomorrowKey, '11:00'), ...base('svc_wash'),
      checklist: { create: checklistCreate('svc_wash', 0) },
      payment: { create: { amountPaise: base('svc_wash').pricePaise, gateway: 'razorpay', status: PaymentStatus.CAPTURED } },
    },
  });

  // 2) Assigned to Ravi — employee captures pickup photos next.
  await prisma.booking.create({
    data: {
      shopId: SHOP_ID, customerMembershipId: DEMO_CUSTOMER.membershipId, vehicleId: 'veh_demo_swift',
      status: BookingStatus.ASSIGNED, scheduledAt: at(todayKey, '16:00'), ...base('svc_foam'),
      notes: 'Please pay attention to the alloy wheels.',
      pickupMembershipId: RAVI, serviceMembershipId: RAVI,
      checklist: { create: checklistCreate('svc_foam', 0) },
      payment: { create: { amountPaise: base('svc_foam').pricePaise, gateway: 'razorpay', status: PaymentStatus.CAPTURED } },
    },
  });

  // 3) Pickup photos sent — awaiting customer approval.
  await prisma.booking.create({
    data: {
      shopId: SHOP_ID, customerMembershipId: DEMO_CUSTOMER.membershipId, vehicleId: 'veh_demo_creta',
      status: BookingStatus.CONDITION_PENDING, scheduledAt: at(todayKey, '14:00'), ...base('svc_interior'),
      pickupMembershipId: PRIYA, serviceMembershipId: RAVI,
      checklist: { create: checklistCreate('svc_interior', 0) },
      conditionReports: { create: [reportCreate(ConditionKind.PICKUP, false, ['pickup-a', 'pickup-b', 'pickup-c'])] },
      payment: { create: { amountPaise: base('svc_interior').pricePaise, gateway: 'razorpay', status: PaymentStatus.CAPTURED } },
    },
  });

  // 4) In progress — checklist partly done, ends with delivery photos.
  await prisma.booking.create({
    data: {
      shopId: SHOP_ID, customerMembershipId: DEMO_CUSTOMER.membershipId, vehicleId: 'veh_demo_swift',
      status: BookingStatus.IN_PROGRESS, scheduledAt: at(todayKey, '12:00'), ...base('svc_full'),
      pickupMembershipId: RAVI, serviceMembershipId: RAVI,
      checklist: { create: checklistCreate('svc_full', 3) },
      conditionReports: { create: [reportCreate(ConditionKind.PICKUP, true, ['prog-a', 'prog-b'])] },
      payment: { create: { amountPaise: base('svc_full').pricePaise, gateway: 'razorpay', status: PaymentStatus.CAPTURED } },
    },
  });

  // 5) Completed history.
  await prisma.booking.create({
    data: {
      shopId: SHOP_ID, customerMembershipId: DEMO_CUSTOMER.membershipId, vehicleId: 'veh_demo_swift',
      status: BookingStatus.COMPLETED, scheduledAt: at(pastKey, '10:30'), ...base('svc_interior'),
      pickupMembershipId: RAVI, serviceMembershipId: RAVI,
      checklist: { create: checklistCreate('svc_interior', 99) },
      conditionReports: {
        create: [
          reportCreate(ConditionKind.PICKUP, true, ['hist-a']),
          reportCreate(ConditionKind.DELIVERY, true, ['hist-b']),
        ],
      },
      payment: { create: { amountPaise: base('svc_interior').pricePaise, gateway: 'razorpay', status: PaymentStatus.CAPTURED } },
    },
  });

  // 6) Completed bike service — feeds the finance bikes-vs-cars split.
  await prisma.booking.create({
    data: {
      shopId: SHOP_ID, customerMembershipId: DEMO_CUSTOMER.membershipId, vehicleId: 'veh_demo_classic',
      status: BookingStatus.COMPLETED, scheduledAt: at(pastKey, '09:30'), ...base('svc_wash'),
      pickupMembershipId: PRIYA, serviceMembershipId: PRIYA,
      checklist: { create: checklistCreate('svc_wash', 99) },
      conditionReports: {
        create: [
          reportCreate(ConditionKind.PICKUP, true, ['bike-a']),
          reportCreate(ConditionKind.DELIVERY, true, ['bike-b']),
        ],
      },
      payment: { create: { amountPaise: base('svc_wash').pricePaise, gateway: 'razorpay', status: PaymentStatus.CAPTURED } },
    },
  });

  // Offers (idempotent reset)
  await prisma.offer.deleteMany({ where: { shopId: SHOP_ID } });
  await prisma.offer.createMany({
    data: [
      { shopId: SHOP_ID, title: 'Monsoon Shine', subtitle: '20% off any Foam Wash & Wax', badge: '20% OFF', photoUrl: photo('1607860108855-64acf2078ed9') },
      { shopId: SHOP_ID, title: 'Weekday Detail', subtitle: '₹500 off Full Detailing, Mon–Thu', badge: '₹500 OFF', photoUrl: photo('1633014041037-f5446fb4ce99') },
      { shopId: SHOP_ID, title: 'Ceramic Season', subtitle: 'Free headlight restore with 9H coating', badge: 'FREE ADD-ON', photoUrl: photo('1622329821376-a19fd6002562') },
    ],
  });

  // Finance ledger — ~6 months of income & expenses (idempotent reset)
  await prisma.financeTxn.deleteMany({ where: { shopId: SHOP_ID } });
  const finance: {
    type: TxnType;
    category: string;
    note: string | null;
    amountPaise: number;
    date: Date;
  }[] = [];
  const addTxn = (monthsAgo: number, day: number, type: TxnType, category: string, rupees: number, note: string | null) => {
    const date = DateTime.now().setZone(ZONE).minus({ months: monthsAgo }).set({ day, hour: 12, minute: 0, second: 0 }).toJSDate();
    finance.push({ type, category, note, amountPaise: Math.round(rupees) * 100, date });
  };
  for (let m = 5; m >= 0; m--) {
    addTxn(m, 5, TxnType.income, 'Wash & detailing', 48000 + ((m * 7) % 20) * 1000, 'Weekly takings');
    addTxn(m, 12, TxnType.income, 'Wash & detailing', 52000 + ((m * 11) % 18) * 1000, 'Weekly takings');
    addTxn(m, 19, TxnType.income, 'Ceramic & protection', 36000 + ((m * 5) % 15) * 1000, null);
    addTxn(m, 26, TxnType.income, 'Memberships', 18000, 'Monthly plans');
    addTxn(m, 1, TxnType.expense, 'Rent', 60000, 'Shop rent');
    addTxn(m, 2, TxnType.expense, 'Salaries', 120000, 'Team payroll');
    addTxn(m, 8, TxnType.expense, 'Supplies', 14000 + ((m * 3) % 10) * 1000, 'Chemicals & consumables');
    addTxn(m, 10, TxnType.expense, 'Inventory', 6000 + ((m * 6) % 9) * 1000, 'Pressure pump, foam soap & wax');
    addTxn(m, 15, TxnType.expense, 'Utilities', 9000 + ((m * 2) % 6) * 1000, 'Water & power');
    addTxn(m, 20, TxnType.expense, 'Marketing', 8000 + ((m * 4) % 8) * 1000, 'Ads & promos');
    if (m % 2 === 0) addTxn(m, 22, TxnType.expense, 'Equipment', 22000, 'Tools & machines');
  }
  await prisma.financeTxn.createMany({ data: finance.map((f) => ({ shopId: SHOP_ID, ...f })) });

  // eslint-disable-next-line no-console
  console.log('Seed complete: shop, working hours, 6 services, 3 staff, 1 demo customer, 6 bookings, 3 offers, finance ledger.');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
