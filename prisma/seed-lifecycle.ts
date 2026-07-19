import {
  DocumentType,
  FuelType,
  InvoiceStatus,
  JobCardStatus,
  MaintenanceUrgency,
  NotificationChannel,
  NotificationStatus,
  PaymentMethod,
  PrismaClient,
  Role,
  ServiceCategory,
  ServiceEventSource,
  TransferStatus,
  TransferType,
  TransmissionType,
  TxnType,
  Weekday,
} from '@prisma/client';
import { DateTime } from 'luxon';

const prisma = new PrismaClient();

const ZONE = 'Asia/Kolkata';
const TENANT_ID = 'tenant_pitstop_hsr';
const SHOP_ID = 'shop_pitstop_hsr';

function daysAgo(days: number): Date {
  return DateTime.now().setZone(ZONE).minus({ days }).toJSDate();
}

function daysFromNow(days: number): Date {
  return DateTime.now().setZone(ZONE).plus({ days }).toJSDate();
}

function isoDate(dateStr: string): Date {
  return DateTime.fromISO(dateStr, { zone: ZONE }).toJSDate();
}

function today(): Date {
  return DateTime.now().setZone(ZONE).startOf('day').toJSDate();
}

export async function main(): Promise<void> {
  // ─── 1. Tenant ───────────────────────────────────────────────
  await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: {},
    create: {
      id: TENANT_ID,
      name: 'PitStop Auto Spa',
      tagline: 'Premium car detailing • HSR Layout',
      address: '27th Main, HSR Layout Sector 2, Bengaluru 560102',
      lat: 12.9121,
      lng: 77.6446,
      timezone: ZONE,
      gstRate: 18,
      gstin: '29AAACI1234F1Z5',
      contactPhone: '+919000000001',
      slotDurationMin: 30,
      slotCapacity: 3,
      legacyShopId: SHOP_ID,
    },
  });

  // Working hours for tenant
  const workingHours: { day: Weekday; open: string; close: string; capacity: number }[] = [
    { day: 'mon', open: '09:00', close: '19:00', capacity: 3 },
    { day: 'tue', open: '09:00', close: '19:00', capacity: 3 },
    { day: 'wed', open: '09:00', close: '19:00', capacity: 3 },
    { day: 'thu', open: '09:00', close: '19:00', capacity: 3 },
    { day: 'fri', open: '09:00', close: '19:00', capacity: 3 },
    { day: 'sat', open: '09:00', close: '19:00', capacity: 3 },
    { day: 'sun', open: '10:00', close: '17:00', capacity: 2 },
  ];

  for (const wh of workingHours) {
    await prisma.tenantWorkingHour.upsert({
      where: { tenantId_day: { tenantId: TENANT_ID, day: wh.day } },
      update: { open: wh.open, close: wh.close, capacity: wh.capacity },
      create: { tenantId: TENANT_ID, day: wh.day, open: wh.open, close: wh.close, capacity: wh.capacity },
    });
  }

  // ─── 2. TenantMemberships ────────────────────────────────────
  const tenantMembers = [
    { id: 'tmem_mgr_anita', userId: 'usr_mgr_anita', role: Role.MANAGER },
    { id: 'tmem_emp_ravi', userId: 'usr_emp_ravi', role: Role.EMPLOYEE },
    { id: 'tmem_emp_priya', userId: 'usr_emp_priya', role: Role.EMPLOYEE },
    { id: 'tmem_cust_aarav', userId: 'usr_demo_aarav', role: Role.CUSTOMER },
  ];

  for (const tm of tenantMembers) {
    await prisma.tenantMembership.upsert({
      where: { userId_tenantId_role: { userId: tm.userId, tenantId: TENANT_ID, role: tm.role } },
      update: {},
      create: { id: tm.id, userId: tm.userId, tenantId: TENANT_ID, role: tm.role },
    });
  }

  // ─── 3. TenantServices ───────────────────────────────────────
  const tenantServices = [
    { id: 'tsvc_wash', name: 'Express Exterior Wash', description: 'Quick hand wash — wheels, body and glass.', pricePaise: 49900, durationMin: 45, icon: 'water', category: 'Wash' },
    { id: 'tsvc_foam', name: 'Premium Foam Wash & Wax', description: 'Snow-foam pre-soak, pH-neutral wash, hand dry and wax.', pricePaise: 129900, durationMin: 90, icon: 'sparkles', category: 'Wash' },
    { id: 'tsvc_interior', name: 'Interior Deep Clean', description: 'Full vacuum, steam-clean, dashboard conditioning.', pricePaise: 179900, durationMin: 120, icon: 'car-sport', category: 'Detail' },
    { id: 'tsvc_full', name: 'Full Detailing — In & Out', description: 'Exterior foam wash, paint decontamination, interior deep clean.', pricePaise: 349900, durationMin: 240, icon: 'brush', category: 'Detail' },
    { id: 'tsvc_ceramic', name: 'Ceramic Coating 9H', description: 'Multi-stage paint correction + 9H ceramic coat.', pricePaise: 1499900, durationMin: 480, icon: 'shield-checkmark', category: 'Protect' },
    { id: 'tsvc_headlight', name: 'Headlight Restoration', description: 'Sand, polish and seal cloudy headlights.', pricePaise: 89900, durationMin: 60, icon: 'bulb', category: 'Detail' },
  ];

  for (const svc of tenantServices) {
    await prisma.tenantService.upsert({
      where: { id: svc.id },
      update: { name: svc.name, pricePaise: svc.pricePaise, durationMin: svc.durationMin },
      create: { id: svc.id, tenantId: TENANT_ID, name: svc.name, description: svc.description, pricePaise: svc.pricePaise, durationMin: svc.durationMin, icon: svc.icon, category: svc.category },
    });
  }

  // ─── 4. VehicleRecords ───────────────────────────────────────
  const vehicles = [
    { id: 'vr_swift', make: 'Maruti', model: 'Swift', year: 2020, registrationPlate: 'KA 01 AB 1234', vin: null, color: 'Pearl White', fuelType: FuelType.PETROL, transmission: TransmissionType.MANUAL, latestOdometerKm: 45230, legacyVehicleId: 'veh_demo_swift' },
    { id: 'vr_creta', make: 'Hyundai', model: 'Creta', year: 2022, registrationPlate: 'KA 05 MJ 9090', vin: 'MALA851CLNM123456', color: 'Midnight Blue', fuelType: FuelType.DIESEL, transmission: TransmissionType.AUTOMATIC, latestOdometerKm: 28100, legacyVehicleId: 'veh_demo_creta' },
    { id: 'vr_classic', make: 'Royal Enfield', model: 'Classic 350', year: 2019, registrationPlate: 'KA 03 HG 4521', vin: null, color: 'Jet Black', fuelType: FuelType.PETROL, transmission: TransmissionType.MANUAL, latestOdometerKm: 32000, legacyVehicleId: 'veh_demo_classic' },
    { id: 'vr_city', make: 'Honda', model: 'City', year: 2021, registrationPlate: 'KA 02 CD 5678', vin: 'MRHGM6670NT000789', color: 'Modern Steel', fuelType: FuelType.PETROL, transmission: TransmissionType.CVT, latestOdometerKm: 51000, legacyVehicleId: null },
  ];

  for (const v of vehicles) {
    await prisma.vehicleRecord.upsert({
      where: { id: v.id },
      update: { latestOdometerKm: v.latestOdometerKm },
      create: {
        id: v.id,
        make: v.make,
        model: v.model,
        year: v.year,
        registrationPlate: v.registrationPlate,
        vin: v.vin,
        color: v.color,
        fuelType: v.fuelType,
        transmission: v.transmission,
        latestOdometerKm: v.latestOdometerKm,
        legacyVehicleId: v.legacyVehicleId,
      },
    });
  }

  // ─── 5. OwnershipRecords ─────────────────────────────────────
  const ownerships = [
    { id: 'own_swift', vehicleRecordId: 'vr_swift', userId: 'usr_demo_aarav', transferType: TransferType.LEGACY_MIGRATION, transferStatus: TransferStatus.CONFIRMED, startDate: isoDate('2020-03-15'), odometerKm: null, confirmedAt: isoDate('2020-03-15') },
    { id: 'own_creta', vehicleRecordId: 'vr_creta', userId: 'usr_demo_aarav', transferType: TransferType.SALE, transferStatus: TransferStatus.CONFIRMED, startDate: isoDate('2022-06-01'), odometerKm: 0, confirmedAt: isoDate('2022-06-01') },
    { id: 'own_classic', vehicleRecordId: 'vr_classic', userId: 'usr_demo_aarav', transferType: TransferType.LEGACY_MIGRATION, transferStatus: TransferStatus.CONFIRMED, startDate: isoDate('2019-11-20'), odometerKm: null, confirmedAt: isoDate('2019-11-20') },
    { id: 'own_city', vehicleRecordId: 'vr_city', userId: 'usr_mgr_anita', transferType: TransferType.SALE, transferStatus: TransferStatus.CONFIRMED, startDate: isoDate('2021-09-10'), odometerKm: 0, confirmedAt: isoDate('2021-09-10') },
  ];

  for (const o of ownerships) {
    await prisma.ownershipRecord.upsert({
      where: { id: o.id },
      update: {},
      create: {
        id: o.id,
        vehicleRecordId: o.vehicleRecordId,
        userId: o.userId,
        transferType: o.transferType,
        transferStatus: o.transferStatus,
        startDate: o.startDate,
        odometerKm: o.odometerKm,
        confirmedAt: o.confirmedAt,
      },
    });
  }

  // ─── 6. ServiceEvents ────────────────────────────────────────
  const serviceEvents = [
    // vr_swift: 3 events
    { id: 'se_swift_oil', vehicleRecordId: 'vr_swift', tenantId: TENANT_ID, tenantName: 'PitStop Auto Spa', serviceType: 'Oil Change', category: ServiceCategory.ROUTINE_MAINTENANCE, description: 'Synthetic 5W30 oil + filter', laborCostPaise: 30000, partsCostPaise: 55000, totalCostPaise: 85000, odometerKm: 42000, technicianName: 'Ravi Kumar', source: ServiceEventSource.JOB_CARD, completedAt: daysAgo(90) },
    { id: 'se_swift_wash', vehicleRecordId: 'vr_swift', tenantId: TENANT_ID, tenantName: 'PitStop Auto Spa', serviceType: 'Exterior Wash', category: ServiceCategory.ROUTINE_MAINTENANCE, description: 'Full exterior wash with wax', laborCostPaise: 20000, partsCostPaise: 5000, totalCostPaise: 49900, odometerKm: 43500, technicianName: 'Priya Nair', source: ServiceEventSource.JOB_CARD, completedAt: daysAgo(45) },
    { id: 'se_swift_brake', vehicleRecordId: 'vr_swift', tenantId: TENANT_ID, tenantName: 'PitStop Auto Spa', serviceType: 'Brake Inspection', category: ServiceCategory.INSPECTION, description: 'Front and rear brake pad check, fluid top-up', laborCostPaise: 40000, partsCostPaise: 0, totalCostPaise: 40000, odometerKm: 44800, technicianName: 'Ravi Kumar', source: ServiceEventSource.OWNER_REPORTED, completedAt: daysAgo(15) },
    // vr_creta: 3 events
    { id: 'se_creta_full', vehicleRecordId: 'vr_creta', tenantId: TENANT_ID, tenantName: 'PitStop Auto Spa', serviceType: 'Full Service', category: ServiceCategory.ROUTINE_MAINTENANCE, description: '20000km scheduled service', laborCostPaise: 150000, partsCostPaise: 250000, totalCostPaise: 400000, odometerKm: 20000, technicianName: 'Ravi Kumar', source: ServiceEventSource.JOB_CARD, completedAt: daysAgo(120) },
    { id: 'se_creta_interior', vehicleRecordId: 'vr_creta', tenantId: TENANT_ID, tenantName: 'PitStop Auto Spa', serviceType: 'Interior Deep Clean', category: ServiceCategory.ROUTINE_MAINTENANCE, description: 'Seats, dashboard, mats deep cleaned', laborCostPaise: 80000, partsCostPaise: 15000, totalCostPaise: 179900, odometerKm: 25000, technicianName: 'Priya Nair', source: ServiceEventSource.JOB_CARD, completedAt: daysAgo(60) },
    { id: 'se_creta_tire', vehicleRecordId: 'vr_creta', tenantId: TENANT_ID, tenantName: 'PitStop Auto Spa', serviceType: 'Tire Rotation', category: ServiceCategory.ROUTINE_MAINTENANCE, description: 'All 4 tires rotated, pressure checked', laborCostPaise: 20000, partsCostPaise: 0, totalCostPaise: 20000, odometerKm: 27500, technicianName: 'Ravi Kumar', source: ServiceEventSource.OWNER_REPORTED, completedAt: daysAgo(20) },
    // vr_classic: 2 events
    { id: 'se_classic_chain', vehicleRecordId: 'vr_classic', tenantId: TENANT_ID, tenantName: 'PitStop Auto Spa', serviceType: 'Chain Service', category: ServiceCategory.ROUTINE_MAINTENANCE, description: 'Chain cleaned, lubed and adjusted', laborCostPaise: 25000, partsCostPaise: 10000, totalCostPaise: 35000, odometerKm: 30000, technicianName: 'Ravi Kumar', source: ServiceEventSource.JOB_CARD, completedAt: daysAgo(150) },
    { id: 'se_classic_checkup', vehicleRecordId: 'vr_classic', tenantId: TENANT_ID, tenantName: 'PitStop Auto Spa', serviceType: 'General Checkup', category: ServiceCategory.INSPECTION, description: 'Full inspection, minor adjustments', laborCostPaise: 50000, partsCostPaise: 20000, totalCostPaise: 70000, odometerKm: 31500, technicianName: 'Priya Nair', source: ServiceEventSource.OWNER_REPORTED, completedAt: daysAgo(100) },
    // vr_city: 2 events
    { id: 'se_city_oil', vehicleRecordId: 'vr_city', tenantId: TENANT_ID, tenantName: 'PitStop Auto Spa', serviceType: 'Oil Change', category: ServiceCategory.ROUTINE_MAINTENANCE, description: 'Synthetic oil change with filter', laborCostPaise: 30000, partsCostPaise: 60000, totalCostPaise: 90000, odometerKm: 40000, technicianName: 'Ravi Kumar', source: ServiceEventSource.JOB_CARD, completedAt: daysAgo(75) },
    { id: 'se_city_align', vehicleRecordId: 'vr_city', tenantId: TENANT_ID, tenantName: 'PitStop Auto Spa', serviceType: 'Wheel Alignment', category: ServiceCategory.REPAIR, description: 'Four-wheel alignment', laborCostPaise: 60000, partsCostPaise: 0, totalCostPaise: 60000, odometerKm: 49000, technicianName: 'Ravi Kumar', source: ServiceEventSource.JOB_CARD, completedAt: daysAgo(30) },
  ];

  for (const se of serviceEvents) {
    await prisma.serviceEvent.upsert({
      where: { id: se.id },
      update: {},
      create: se,
    });
  }

  // ─── 7. HealthScores ─────────────────────────────────────────
  const healthScores = [
    { id: 'hs_swift', vehicleRecordId: 'vr_swift', score: 72, maintenanceCompliance: 80, timeSinceService: 65, vehicleAge: 80, serviceCount: 50, unresolvedIssues: 100 },
    { id: 'hs_creta', vehicleRecordId: 'vr_creta', score: 85, maintenanceCompliance: 90, timeSinceService: 80, vehicleAge: 92, serviceCount: 40, unresolvedIssues: 100 },
    { id: 'hs_classic', vehicleRecordId: 'vr_classic', score: 45, maintenanceCompliance: 40, timeSinceService: 30, vehicleAge: 72, serviceCount: 30, unresolvedIssues: 60 },
    { id: 'hs_city', vehicleRecordId: 'vr_city', score: 68, maintenanceCompliance: 70, timeSinceService: 55, vehicleAge: 88, serviceCount: 60, unresolvedIssues: 80 },
  ];

  for (const hs of healthScores) {
    await prisma.healthScore.upsert({
      where: { vehicleRecordId: hs.vehicleRecordId },
      update: { score: hs.score, maintenanceCompliance: hs.maintenanceCompliance, timeSinceService: hs.timeSinceService, vehicleAge: hs.vehicleAge, serviceCount: hs.serviceCount, unresolvedIssues: hs.unresolvedIssues, calculatedAt: new Date() },
      create: { ...hs, calculatedAt: new Date() },
    });
  }

  // ─── 8. InventoryItems ───────────────────────────────────────
  const inventoryItems = [
    { id: 'inv_oil_filter', name: 'Oil Filter', sku: 'OIL-FLT-001', category: 'Filters', quantity: 25, unitCostPaise: 15000, sellingPricePaise: 25000, reorderThreshold: 5 },
    { id: 'inv_brake_pad', name: 'Brake Pad Set', sku: 'BRK-PAD-001', category: 'Brakes', quantity: 8, unitCostPaise: 120000, sellingPricePaise: 180000, reorderThreshold: 3 },
    { id: 'inv_wiper', name: 'Wiper Blades', sku: 'WPR-BLD-001', category: 'Accessories', quantity: 15, unitCostPaise: 8000, sellingPricePaise: 15000, reorderThreshold: 5 },
    { id: 'inv_engine_oil', name: 'Engine Oil 5W30', sku: 'ENG-OIL-5W30', category: 'Oils', quantity: 40, unitCostPaise: 45000, sellingPricePaise: 65000, reorderThreshold: 10 },
    { id: 'inv_air_filter', name: 'Air Filter', sku: 'AIR-FLT-001', category: 'Filters', quantity: 12, unitCostPaise: 12000, sellingPricePaise: 20000, reorderThreshold: 4 },
    { id: 'inv_spark_plug', name: 'Spark Plug Set', sku: 'SPK-PLG-001', category: 'Ignition', quantity: 2, unitCostPaise: 35000, sellingPricePaise: 55000, reorderThreshold: 3 },
    { id: 'inv_coolant', name: 'Coolant 1L', sku: 'CLN-001', category: 'Fluids', quantity: 30, unitCostPaise: 6000, sellingPricePaise: 12000, reorderThreshold: 8 },
    { id: 'inv_wheel_bearing', name: 'Wheel Bearing', sku: 'WHL-BRG-001', category: 'Bearings', quantity: 0, unitCostPaise: 85000, sellingPricePaise: 120000, reorderThreshold: 2 },
  ];

  for (const item of inventoryItems) {
    await prisma.inventoryItem.upsert({
      where: { tenantId_sku: { tenantId: TENANT_ID, sku: item.sku } },
      update: { quantity: item.quantity },
      create: {
        id: item.id,
        tenantId: TENANT_ID,
        name: item.name,
        sku: item.sku,
        category: item.category,
        quantity: item.quantity,
        unitCostPaise: item.unitCostPaise,
        sellingPricePaise: item.sellingPricePaise,
        reorderThreshold: item.reorderThreshold,
      },
    });
  }

  // ─── 9. JobCards ─────────────────────────────────────────────
  // JC1: CREATED (tomorrow, appointment), vr_swift, wash
  await prisma.jobCard.upsert({
    where: { id: 'jc_001' },
    update: {},
    create: {
      id: 'jc_001',
      tenantId: TENANT_ID,
      vehicleRecordId: 'vr_swift',
      customerId: 'usr_demo_aarav',
      status: JobCardStatus.CREATED,
      scheduledAt: daysFromNow(1),
      items: { create: [{ id: 'jci_001_wash', serviceId: 'tsvc_wash', pricePaise: 49900, durationMin: 45 }] },
    },
  });

  // JC2: ASSIGNED (today), vr_creta, foam wash, assigned to Ravi
  await prisma.jobCard.upsert({
    where: { id: 'jc_002' },
    update: {},
    create: {
      id: 'jc_002',
      tenantId: TENANT_ID,
      vehicleRecordId: 'vr_creta',
      customerId: 'usr_demo_aarav',
      status: JobCardStatus.ASSIGNED,
      assignedTechId: 'usr_emp_ravi',
      scheduledAt: today(),
      items: { create: [{ id: 'jci_002_foam', serviceId: 'tsvc_foam', pricePaise: 129900, durationMin: 90 }] },
    },
  });

  // JC3: IN_PROGRESS (today), vr_city, full detailing + headlight
  await prisma.jobCard.upsert({
    where: { id: 'jc_003' },
    update: {},
    create: {
      id: 'jc_003',
      tenantId: TENANT_ID,
      vehicleRecordId: 'vr_city',
      customerId: 'usr_mgr_anita',
      status: JobCardStatus.IN_PROGRESS,
      assignedTechId: 'usr_emp_ravi',
      scheduledAt: today(),
      items: {
        create: [
          { id: 'jci_003_full', serviceId: 'tsvc_full', pricePaise: 349900, durationMin: 240 },
          { id: 'jci_003_headlight', serviceId: 'tsvc_headlight', pricePaise: 89900, durationMin: 60 },
        ],
      },
      partsConsumed: {
        create: [
          { id: 'jcp_003_oil', inventoryItemId: 'inv_oil_filter', quantity: 1, unitCostPaise: 15000 },
          { id: 'jcp_003_wiper', inventoryItemId: 'inv_wiper', quantity: 1, unitCostPaise: 8000 },
        ],
      },
      laborNotes: {
        create: [{ id: 'jcn_003_note', authorId: 'usr_emp_ravi', content: 'Started full detailing. Paint has minor swirl marks, will do extra correction pass.' }],
      },
    },
  });

  // JC4: COMPLETED (2 days ago), vr_swift, interior clean — has invoice
  await prisma.jobCard.upsert({
    where: { id: 'jc_004' },
    update: {},
    create: {
      id: 'jc_004',
      tenantId: TENANT_ID,
      vehicleRecordId: 'vr_swift',
      customerId: 'usr_demo_aarav',
      status: JobCardStatus.COMPLETED,
      assignedTechId: 'usr_emp_priya',
      scheduledAt: daysAgo(2),
      items: { create: [{ id: 'jci_004_interior', serviceId: 'tsvc_interior', pricePaise: 179900, durationMin: 120 }] },
    },
  });

  // JC5: INVOICED (5 days ago), vr_creta, ceramic coating — has invoice + payments
  await prisma.jobCard.upsert({
    where: { id: 'jc_005' },
    update: {},
    create: {
      id: 'jc_005',
      tenantId: TENANT_ID,
      vehicleRecordId: 'vr_creta',
      customerId: 'usr_demo_aarav',
      status: JobCardStatus.INVOICED,
      assignedTechId: 'usr_emp_ravi',
      scheduledAt: daysAgo(5),
      items: { create: [{ id: 'jci_005_ceramic', serviceId: 'tsvc_ceramic', pricePaise: 1499900, durationMin: 480 }] },
    },
  });

  // ─── 10. Invoices ────────────────────────────────────────────
  // Invoice for JC4 (ISSUED, unpaid)
  await prisma.invoice.upsert({
    where: { jobCardId: 'jc_004' },
    update: {},
    create: {
      id: 'inv_jc_004',
      tenantId: TENANT_ID,
      jobCardId: 'jc_004',
      invoiceNumber: 'INV-2024-0042',
      customerId: 'usr_demo_aarav',
      customerName: 'Aarav Sharma',
      customerPhone: '+919812300000',
      vehicleSummary: 'Maruti Swift 2020 - KA 01 AB 1234',
      subtotalPaise: 179900,
      taxPaise: 32382,
      totalPaise: 212282,
      status: InvoiceStatus.ISSUED,
      lineItems: {
        create: [
          { id: 'ili_004_svc', description: 'Interior Deep Clean', quantity: 1, unitPaise: 179900, totalPaise: 179900, type: 'service' },
        ],
      },
    },
  });

  // Invoice for JC5 (PAID, with 2 payments)
  await prisma.invoice.upsert({
    where: { jobCardId: 'jc_005' },
    update: {},
    create: {
      id: 'inv_jc_005',
      tenantId: TENANT_ID,
      jobCardId: 'jc_005',
      invoiceNumber: 'INV-2024-0043',
      customerId: 'usr_demo_aarav',
      customerName: 'Aarav Sharma',
      customerPhone: '+919812300000',
      vehicleSummary: 'Hyundai Creta 2022 - KA 05 MJ 9090',
      subtotalPaise: 1499900,
      taxPaise: 269982,
      totalPaise: 1769882,
      status: InvoiceStatus.PAID,
      lineItems: {
        create: [
          { id: 'ili_005_svc', description: 'Ceramic Coating 9H', quantity: 1, unitPaise: 1499900, totalPaise: 1499900, type: 'service' },
        ],
      },
      payments: {
        create: [
          { id: 'ipay_005_upi', amountPaise: 1000000, method: PaymentMethod.UPI, reference: 'UPI/345678901234', paidAt: daysAgo(5) },
          { id: 'ipay_005_card', amountPaise: 769882, method: PaymentMethod.CARD, reference: 'CARD-XXXX-4532', paidAt: daysAgo(5) },
        ],
      },
    },
  });

  // ─── 11. MaintenanceTemplates ────────────────────────────────
  await prisma.maintenanceTemplate.upsert({
    where: { tenantId_make_model: { tenantId: TENANT_ID, make: 'Maruti', model: 'Swift' } },
    update: {},
    create: {
      id: 'mt_swift',
      tenantId: TENANT_ID,
      make: 'Maruti',
      model: 'Swift',
      items: [
        { serviceType: 'Oil Change', intervalKm: 10000, intervalMonths: 6 },
        { serviceType: 'Brake Inspection', intervalKm: 20000, intervalMonths: 12 },
        { serviceType: 'Air Filter', intervalKm: 15000, intervalMonths: 12 },
      ],
    },
  });

  await prisma.maintenanceTemplate.upsert({
    where: { tenantId_make_model: { tenantId: TENANT_ID, make: 'Honda', model: 'City' } },
    update: {},
    create: {
      id: 'mt_city',
      tenantId: TENANT_ID,
      make: 'Honda',
      model: 'City',
      items: [
        { serviceType: 'Oil Change', intervalKm: 10000, intervalMonths: 6 },
        { serviceType: 'Transmission Fluid', intervalKm: 40000, intervalMonths: 24 },
        { serviceType: 'Spark Plugs', intervalKm: 30000, intervalMonths: 18 },
      ],
    },
  });

  // ─── 12. MaintenanceScheduleEntries ──────────────────────────
  const scheduleEntries = [
    { id: 'mse_swift_oil', vehicleRecordId: 'vr_swift', serviceType: 'Oil Change', dueDate: daysAgo(14), dueOdometerKm: 45000, estimatedCostPaise: 85000, urgency: MaintenanceUrgency.OVERDUE },
    { id: 'mse_swift_brake', vehicleRecordId: 'vr_swift', serviceType: 'Brake Inspection', dueDate: daysFromNow(5), dueOdometerKm: 50000, estimatedCostPaise: 40000, urgency: MaintenanceUrgency.DUE_SOON },
    { id: 'mse_city_oil', vehicleRecordId: 'vr_city', serviceType: 'Oil Change', dueDate: daysFromNow(45), dueOdometerKm: 55000, estimatedCostPaise: 90000, urgency: MaintenanceUrgency.UPCOMING },
    { id: 'mse_city_spark', vehicleRecordId: 'vr_city', serviceType: 'Spark Plugs', dueDate: null, dueOdometerKm: 52000, estimatedCostPaise: 55000, urgency: MaintenanceUrgency.DUE_SOON },
  ];

  for (const entry of scheduleEntries) {
    await prisma.maintenanceScheduleEntry.upsert({
      where: { id: entry.id },
      update: { urgency: entry.urgency },
      create: entry,
    });
  }

  // ─── 13. Fleet ───────────────────────────────────────────────
  await prisma.fleet.upsert({
    where: { id: 'fleet_anita_corp' },
    update: {},
    create: {
      id: 'fleet_anita_corp',
      ownerId: 'usr_mgr_anita',
      name: 'Anita Transport Corp',
      organizationName: 'Anita Enterprises Pvt Ltd',
      organizationRegNumber: 'U74999KA2020PTC123456',
      drivers: {
        create: [
          { id: 'fd_rajesh', name: 'Rajesh', contactPhone: '+919876543210' },
          { id: 'fd_suresh', name: 'Suresh', contactPhone: '+919876543211' },
        ],
      },
      vehicles: {
        create: [
          { id: 'fv_city', vehicleRecordId: 'vr_city', assignedDriverId: 'fd_rajesh' },
        ],
      },
    },
  });

  // ─── 14. Notifications ───────────────────────────────────────
  const notifications = [
    { id: 'notif_appt_reminder', tenantId: TENANT_ID, userId: 'usr_demo_aarav', channel: NotificationChannel.PUSH, eventType: 'appointment.reminder', title: 'Appointment Tomorrow', body: 'Your Express Exterior Wash for Maruti Swift is scheduled for tomorrow at 11:00 AM.', status: NotificationStatus.DELIVERED, deliveredAt: daysAgo(0) },
    { id: 'notif_health_alert', tenantId: TENANT_ID, userId: 'usr_demo_aarav', channel: NotificationChannel.PUSH, eventType: 'health_score.alert', title: 'Vehicle Health Alert', body: 'Your Royal Enfield Classic 350 health score dropped below 50. Consider scheduling maintenance.', status: NotificationStatus.PENDING },
    { id: 'notif_low_stock', tenantId: TENANT_ID, userId: 'usr_mgr_anita', channel: NotificationChannel.PUSH, eventType: 'inventory.low_stock', title: 'Low Stock Alert', body: 'Spark Plug Set (SPK-PLG-001) is below reorder threshold. Only 2 remaining.', status: NotificationStatus.DELIVERED, deliveredAt: daysAgo(1) },
  ];

  for (const n of notifications) {
    await prisma.notification.upsert({
      where: { id: n.id },
      update: {},
      create: n,
    });
  }

  // ─── 15. VehicleDocuments ────────────────────────────────────
  const documents = [
    { id: 'vdoc_swift_insurance', vehicleRecordId: 'vr_swift', documentType: DocumentType.INSURANCE, issuer: 'ICICI Lombard', issueDate: isoDate('2024-01-15'), expiryDate: daysFromNow(20), fileUrl: 'https://storage.example.com/docs/swift_insurance.pdf', fileSizeBytes: 2202009, mimeType: 'application/pdf' },
    { id: 'vdoc_swift_registration', vehicleRecordId: 'vr_swift', documentType: DocumentType.REGISTRATION, issuer: 'RTO Karnataka', issueDate: isoDate('2020-03-15'), expiryDate: isoDate('2035-03-14'), fileUrl: 'https://storage.example.com/docs/swift_rc.jpg', fileSizeBytes: 1572864, mimeType: 'image/jpeg' },
  ];

  for (const doc of documents) {
    await prisma.vehicleDocument.upsert({
      where: { id: doc.id },
      update: {},
      create: doc,
    });
  }

  // ─── 16. NotificationPreferences ─────────────────────────────
  const prefs = [
    { id: 'npref_aarav_push_appt', userId: 'usr_demo_aarav', eventType: 'appointment.reminder', channel: NotificationChannel.PUSH, enabled: true },
    { id: 'npref_aarav_push_health', userId: 'usr_demo_aarav', eventType: 'health_score.alert', channel: NotificationChannel.PUSH, enabled: true },
    { id: 'npref_aarav_push_invoice', userId: 'usr_demo_aarav', eventType: 'invoice.generated', channel: NotificationChannel.PUSH, enabled: true },
    { id: 'npref_aarav_email_invoice', userId: 'usr_demo_aarav', eventType: 'invoice.generated', channel: NotificationChannel.EMAIL, enabled: true },
    { id: 'npref_aarav_push_maint', userId: 'usr_demo_aarav', eventType: 'maintenance.due', channel: NotificationChannel.PUSH, enabled: true },
  ];

  for (const pref of prefs) {
    await prisma.notificationPreference.upsert({
      where: { userId_eventType_channel: { userId: pref.userId, eventType: pref.eventType, channel: pref.channel } },
      update: { enabled: pref.enabled },
      create: pref,
    });
  }

  // eslint-disable-next-line no-console
  console.log('Lifecycle seed complete: tenant, vehicles, ownership, service events, health scores, inventory, job cards, invoices, maintenance, fleet, notifications, documents.');
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
