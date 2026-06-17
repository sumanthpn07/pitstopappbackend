// Response shapes returned to the mobile app. These mirror the client's
// `src/api/contracts.ts` exactly. Enum string values match Prisma's enums.
import type {
  BookingStatus,
  ConditionKind,
  PaymentStatus,
  PickupTripStatus,
  Role,
} from '@prisma/client';

export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface DayHoursDTO {
  open: string;
  close: string;
  capacity: number;
  closed: boolean;
}
export type WorkingHoursDTO = Record<WeekdayKey, DayHoursDTO>;

export interface ShopDTO {
  id: string;
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  timezone: string;
  rating: number | null;
  ratingCount: number | null;
}

export interface ServiceDTO {
  id: string;
  shopId: string;
  name: string;
  description: string | null;
  pricePaise: number;
  durationMin: number;
  photoUrl: string | null;
  active: boolean;
  icon?: string;
  category?: string;
}

export interface VehicleDTO {
  id: string;
  makeModel: string;
  plate: string | null;
  color: string | null;
  /** "Car" | "Bike" — drives the finance bikes-vs-cars split. */
  type: string | null;
}

export interface ChecklistItemDTO {
  id: string;
  label: string;
  done: boolean;
  doneAt: string | null;
}

export interface BookingPartyDTO {
  membershipId: string;
  name: string | null;
  phone: string | null;
}

export interface ConditionPhotoDTO {
  id: string;
  url: string;
  caption: string | null;
  createdAt: string;
}

export interface ConditionReportDTO {
  id: string;
  bookingId: string;
  kind: ConditionKind;
  customerVerifiedAt: string | null;
  photos: ConditionPhotoDTO[];
  createdAt: string;
}

export interface PaymentDTO {
  id: string;
  bookingId: string;
  amountPaise: number;
  gateway: string;
  status: PaymentStatus;
}

export interface PickupAddressDTO {
  fullAddress: string;
  landmark: string | null;
  city: string | null;
  lat: number;
  lng: number;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
}

export interface PickupTripPointDTO {
  id: string;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  recordedAt: string;
}

export interface PickupTripDTO {
  id: string;
  bookingId: string;
  employeeMembershipId: string | null;
  status: PickupTripStatus;
  startedAt: string | null;
  reachedGarageAt: string | null;
  lastEtaMin: number | null;
  lastLocation: PickupTripPointDTO | null;
  path: PickupTripPointDTO[];
}

export interface BookingDTO {
  id: string;
  shopId: string;
  status: BookingStatus;
  scheduledAt: string;
  durationMin: number;
  pricePaise: number;
  notes: string | null;
  service: ServiceDTO;
  vehicle: VehicleDTO | null;
  customer: BookingPartyDTO;
  employee: BookingPartyDTO | null;
  pickupEmployee: BookingPartyDTO | null;
  serviceEmployee: BookingPartyDTO | null;
  pickupAddress: PickupAddressDTO | null;
  pickupTrip: PickupTripDTO | null;
  conditionReports: ConditionReportDTO[];
  checklist: ChecklistItemDTO[];
  payment: PaymentDTO | null;
  createdAt: string;
}

export interface AvailabilitySlotDTO {
  startAt: string;
  remaining: number;
}

export interface MembershipDTO {
  id: string;
  shopId: string;
  role: Role;
  shopName: string;
}

export interface StaffMemberDTO {
  membershipId: string;
  userId: string;
  name: string;
  phone: string;
  role: Role;
  activeTasks: number;
}

export interface UserDTO {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
}

export interface LoginMethodDTO {
  provider: 'PHONE' | 'GOOGLE' | 'APPLE';
  email: string | null;
  phone: string | null;
}

export interface MeDTO {
  user: UserDTO;
  memberships: MembershipDTO[];
  loginMethods: LoginMethodDTO[];
}

/** Outcome of POST /auth/link. `merge_required` is returned (without merging) when
 *  the identity already belongs to another account — the client confirms first. */
export type LinkResultDTO =
  | { status: 'linked' | 'already_linked' | 'merged' }
  | { status: 'merge_required'; conflict: { bookings: number; vehicles: number } };

export interface TokensDTO {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface OtpRequestResultDTO {
  expiresInSeconds: number;
  devCode?: string;
}

export interface OfferDTO {
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  photoUrl: string | null;
}

export type TxnType = 'income' | 'expense';

export interface FinanceTxnDTO {
  id: string;
  type: TxnType;
  category: string;
  note: string | null;
  amountPaise: number;
  date: string;
}
