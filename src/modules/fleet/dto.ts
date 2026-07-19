/**
 * DTOs for the Fleet module.
 */

export interface CreateFleetDto {
  /** Fleet name (max 100 characters) */
  name: string;
  /** Organization name */
  organizationName: string;
  /** Organization registration number (optional) */
  organizationRegNumber?: string;
  /** Drivers to assign to the fleet */
  drivers?: CreateFleetDriverDto[];
}

export interface CreateFleetDriverDto {
  name: string;
  contactPhone: string;
}

export interface AddVehicleToFleetDto {
  /** ID of the VehicleRecord to assign to the fleet */
  vehicleRecordId: string;
  /** Optional: assign to a specific driver */
  assignedDriverId?: string;
}
