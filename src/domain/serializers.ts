import {
  Prisma,
  type ChecklistItem,
  type ConditionPhoto,
  type FinanceTxn,
  type Offer,
  type Payment,
  type PickupTripPoint,
  type Service,
  type Shop,
  type Vehicle,
  type WorkingHour,
} from '@prisma/client';
import type {
  BookingDTO,
  BookingPartyDTO,
  ChecklistItemDTO,
  ConditionPhotoDTO,
  ConditionReportDTO,
  FinanceTxnDTO,
  MeDTO,
  MembershipDTO,
  OfferDTO,
  PaymentDTO,
  PickupAddressDTO,
  PickupTripDTO,
  PickupTripPointDTO,
  ServiceDTO,
  ShopDTO,
  StaffMemberDTO,
  VehicleDTO,
  WeekdayKey,
  WorkingHoursDTO,
} from './contracts';

/** Canonical relation graph fetched whenever a Booking is serialized. */
export const bookingInclude = {
  shop: true,
  service: true,
  vehicle: true,
  customer: { include: { user: true } },
  pickupEmployee: { include: { user: true } },
  serviceEmployee: { include: { user: true } },
  conditionReports: {
    include: { photos: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  },
  checklist: { orderBy: { position: 'asc' } },
  payment: true,
  pickupTrip: {
    include: { points: { orderBy: { recordedAt: 'asc' } } },
  },
} satisfies Prisma.BookingInclude;

export type BookingWithRelations = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;
type MembershipWithUser = Prisma.MembershipGetPayload<{ include: { user: true } }>;
type ReportWithPhotos = Prisma.ConditionReportGetPayload<{ include: { photos: true } }>;
type TripWithPoints = Prisma.PickupTripGetPayload<{ include: { points: true } }>;
type UserWithMemberships = Prisma.UserGetPayload<{
  include: { memberships: { include: { shop: true } } };
}>;

function partyOf(m: MembershipWithUser | null): BookingPartyDTO | null {
  if (!m) return null;
  return { membershipId: m.id, name: m.user.name, phone: m.user.phone };
}

export function serializeShop(s: Shop): ShopDTO {
  return {
    id: s.id,
    name: s.name,
    tagline: s.tagline ?? null,
    logoUrl: s.logoUrl ?? null,
    address: s.address ?? null,
    lat: s.lat ?? null,
    lng: s.lng ?? null,
    timezone: s.timezone,
    rating: s.rating ?? null,
    ratingCount: s.ratingCount ?? null,
  };
}

export function serializeService(s: Service): ServiceDTO {
  return {
    id: s.id,
    shopId: s.shopId,
    name: s.name,
    description: s.description ?? null,
    pricePaise: s.pricePaise,
    durationMin: s.durationMin,
    photoUrl: s.photoUrl ?? null,
    active: s.active,
    ...(s.icon ? { icon: s.icon } : {}),
    ...(s.category ? { category: s.category } : {}),
  };
}

export function serializeVehicle(v: Vehicle): VehicleDTO {
  return {
    id: v.id,
    makeModel: v.makeModel,
    plate: v.plate ?? null,
    color: v.color ?? null,
    type: v.type ?? null,
  };
}

export function serializeOffer(o: Offer): OfferDTO {
  return {
    id: o.id,
    title: o.title,
    subtitle: o.subtitle,
    badge: o.badge,
    photoUrl: o.photoUrl ?? null,
  };
}

export function serializeFinanceTxn(t: FinanceTxn): FinanceTxnDTO {
  return {
    id: t.id,
    type: t.type,
    category: t.category,
    note: t.note ?? null,
    amountPaise: t.amountPaise,
    date: t.date.toISOString(),
  };
}

export function serializeChecklistItem(c: ChecklistItem): ChecklistItemDTO {
  return {
    id: c.id,
    label: c.label,
    done: c.done,
    doneAt: c.doneAt ? c.doneAt.toISOString() : null,
  };
}

function serializePhoto(p: ConditionPhoto): ConditionPhotoDTO {
  return {
    id: p.id,
    url: p.url,
    caption: p.caption ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

export function serializeReport(r: ReportWithPhotos): ConditionReportDTO {
  return {
    id: r.id,
    bookingId: r.bookingId,
    kind: r.kind,
    customerVerifiedAt: r.customerVerifiedAt ? r.customerVerifiedAt.toISOString() : null,
    photos: r.photos.map(serializePhoto),
    createdAt: r.createdAt.toISOString(),
  };
}

function serializePayment(p: Payment): PaymentDTO {
  return {
    id: p.id,
    bookingId: p.bookingId,
    amountPaise: p.amountPaise,
    gateway: p.gateway,
    status: p.status,
  };
}

function serializeTripPoint(p: PickupTripPoint): PickupTripPointDTO {
  return {
    id: p.id,
    lat: p.lat,
    lng: p.lng,
    speed: p.speed ?? null,
    heading: p.heading ?? null,
    accuracy: p.accuracy ?? null,
    recordedAt: p.recordedAt.toISOString(),
  };
}

export function serializePickupTrip(trip: TripWithPoints): PickupTripDTO {
  const path = trip.points.map(serializeTripPoint);
  return {
    id: trip.id,
    bookingId: trip.bookingId,
    employeeMembershipId: trip.employeeMembershipId ?? null,
    status: trip.status,
    startedAt: trip.startedAt ? trip.startedAt.toISOString() : null,
    reachedGarageAt: trip.reachedGarageAt ? trip.reachedGarageAt.toISOString() : null,
    lastEtaMin: trip.lastEtaMin ?? null,
    lastLocation: path.length ? path[path.length - 1] : null,
    path,
  };
}

function serializePickupAddress(b: BookingWithRelations): PickupAddressDTO | null {
  if (!b.pickupAddress || b.pickupLat === null || b.pickupLng === null) return null;
  return {
    fullAddress: b.pickupAddress,
    landmark: b.pickupLandmark ?? null,
    city: b.pickupCity ?? null,
    lat: b.pickupLat,
    lng: b.pickupLng,
    contactName: b.pickupContactName ?? null,
    contactPhone: b.pickupContactPhone ?? null,
    notes: b.pickupNotes ?? null,
  };
}

export function serializeBooking(b: BookingWithRelations): BookingDTO {
  const serviceEmployee = partyOf(b.serviceEmployee);
  return {
    id: b.id,
    shopId: b.shopId,
    status: b.status,
    scheduledAt: b.scheduledAt.toISOString(),
    durationMin: b.durationMin,
    pricePaise: b.pricePaise,
    notes: b.notes ?? null,
    service: serializeService(b.service),
    vehicle: b.vehicle ? serializeVehicle(b.vehicle) : null,
    customer: partyOf(b.customer) as BookingPartyDTO,
    employee: serviceEmployee,
    pickupEmployee: partyOf(b.pickupEmployee),
    serviceEmployee,
    pickupAddress: serializePickupAddress(b),
    pickupTrip: b.pickupTrip ? serializePickupTrip(b.pickupTrip) : null,
    conditionReports: b.conditionReports.map(serializeReport),
    checklist: b.checklist.map(serializeChecklistItem),
    payment: b.payment ? serializePayment(b.payment) : null,
    createdAt: b.createdAt.toISOString(),
  };
}

export function serializeMe(user: UserWithMemberships): MeDTO {
  return {
    user: {
      id: user.id,
      phone: user.phone,
      name: user.name ?? null,
      email: user.email ?? null,
    },
    memberships: user.memberships.map(
      (m): MembershipDTO => ({
        id: m.id,
        shopId: m.shopId,
        role: m.role,
        shopName: m.shop.name,
      }),
    ),
  };
}

export function serializeStaff(m: MembershipWithUser, activeTasks: number): StaffMemberDTO {
  return {
    membershipId: m.id,
    userId: m.userId,
    name: m.user.name ?? '',
    phone: m.user.phone,
    role: m.role,
    activeTasks,
  };
}

export function workingHoursToDto(rows: WorkingHour[]): WorkingHoursDTO {
  const out = {} as WorkingHoursDTO;
  for (const r of rows) {
    out[r.day as WeekdayKey] = {
      open: r.open,
      close: r.close,
      capacity: r.capacity,
      closed: r.closed,
    };
  }
  return out;
}
