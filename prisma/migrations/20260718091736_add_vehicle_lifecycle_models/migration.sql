-- CreateEnum
CREATE TYPE "JobCardStatus" AS ENUM ('CREATED', 'ASSIGNED', 'IN_PROGRESS', 'QUALITY_CHECK', 'COMPLETED', 'INVOICED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransferType" AS ENUM ('SALE', 'GIFT', 'FLEET_REASSIGNMENT', 'FLEET_ASSIGNMENT', 'LEGACY_MIGRATION');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'CONFIRMED', 'EXPIRED', 'DECLINED');

-- CreateEnum
CREATE TYPE "ServiceCategory" AS ENUM ('ROUTINE_MAINTENANCE', 'REPAIR', 'ACCIDENT_REPAIR', 'INSPECTION', 'MODIFICATION');

-- CreateEnum
CREATE TYPE "ServiceEventSource" AS ENUM ('JOB_CARD', 'OWNER_REPORTED', 'MIGRATION');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'CARD', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('PURCHASE', 'CONSUMPTION', 'RETURN', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "MaintenanceUrgency" AS ENUM ('OVERDUE', 'DUE_SOON', 'UPCOMING');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'SMS', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'PERMANENTLY_FAILED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('INSURANCE', 'REGISTRATION', 'POLLUTION_CERTIFICATE', 'WARRANTY');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('PETROL', 'DIESEL', 'CNG', 'ELECTRIC', 'HYBRID');

-- CreateEnum
CREATE TYPE "TransmissionType" AS ENUM ('MANUAL', 'AUTOMATIC', 'CVT');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "logoUrl" TEXT,
    "address" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gstin" TEXT,
    "contactPhone" TEXT,
    "slotDurationMin" INTEGER NOT NULL DEFAULT 30,
    "slotCapacity" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legacyShopId" TEXT,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantWorkingHour" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "day" "Weekday" NOT NULL,
    "open" TEXT NOT NULL,
    "close" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TenantWorkingHour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantService" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pricePaise" INTEGER NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "photoUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "icon" TEXT,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleRecord" (
    "id" TEXT NOT NULL,
    "vin" TEXT,
    "chassisNumber" TEXT,
    "registrationPlate" TEXT,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "color" TEXT,
    "fuelType" "FuelType",
    "engineCapacityCc" INTEGER,
    "transmission" "TransmissionType",
    "photoUrl" TEXT,
    "latestOdometerKm" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "legacyVehicleId" TEXT,

    CONSTRAINT "VehicleRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleAuditEntry" (
    "id" TEXT NOT NULL,
    "vehicleRecordId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fieldChanged" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleAuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnershipRecord" (
    "id" TEXT NOT NULL,
    "vehicleRecordId" TEXT NOT NULL,
    "userId" TEXT,
    "anonymizedId" TEXT,
    "transferType" "TransferType" NOT NULL,
    "transferStatus" "TransferStatus" NOT NULL DEFAULT 'CONFIRMED',
    "odometerKm" INTEGER,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "initiatedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnershipRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceEvent" (
    "id" TEXT NOT NULL,
    "vehicleRecordId" TEXT NOT NULL,
    "tenantId" TEXT,
    "tenantName" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "category" "ServiceCategory" NOT NULL,
    "description" TEXT,
    "partsUsed" JSONB,
    "laborCostPaise" INTEGER,
    "partsCostPaise" INTEGER,
    "totalCostPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "odometerKm" INTEGER,
    "technicianName" TEXT,
    "source" "ServiceEventSource" NOT NULL,
    "jobCardId" TEXT,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthScore" (
    "id" TEXT NOT NULL,
    "vehicleRecordId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "maintenanceCompliance" INTEGER NOT NULL,
    "timeSinceService" INTEGER NOT NULL,
    "vehicleAge" INTEGER NOT NULL,
    "serviceCount" INTEGER NOT NULL,
    "unresolvedIssues" INTEGER NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobCard" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleRecordId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "JobCardStatus" NOT NULL DEFAULT 'CREATED',
    "assignedTechId" TEXT,
    "estimatedCompletion" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "reworkCount" INTEGER NOT NULL DEFAULT 0,
    "reworkReason" TEXT,
    "cancellationReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobCardItem" (
    "id" TEXT NOT NULL,
    "jobCardId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "durationMin" INTEGER NOT NULL,

    CONSTRAINT "JobCardItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobCardPart" (
    "id" TEXT NOT NULL,
    "jobCardId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCostPaise" INTEGER NOT NULL,
    "reversed" BOOLEAN NOT NULL DEFAULT false,
    "reversalReason" TEXT,

    CONSTRAINT "JobCardPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobCardNote" (
    "id" TEXT NOT NULL,
    "jobCardId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobCardNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobCardPhoto" (
    "id" TEXT NOT NULL,
    "jobCardId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobCardPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "category" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "unitCostPaise" INTEGER NOT NULL,
    "sellingPricePaise" INTEGER NOT NULL,
    "reorderThreshold" INTEGER NOT NULL DEFAULT 0,
    "preferredVendor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "type" "InventoryMovementType" NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "referenceId" TEXT,
    "staffId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobCardId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "vehicleSummary" TEXT NOT NULL,
    "subtotalPaise" INTEGER NOT NULL,
    "taxPaise" INTEGER NOT NULL,
    "totalPaise" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLineItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPaise" INTEGER NOT NULL,
    "totalPaise" INTEGER NOT NULL,
    "type" TEXT NOT NULL,

    CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoicePayment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoicePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "items" JSONB NOT NULL,

    CONSTRAINT "MaintenanceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceScheduleEntry" (
    "id" TEXT NOT NULL,
    "vehicleRecordId" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "dueOdometerKm" INTEGER,
    "estimatedCostPaise" INTEGER,
    "urgency" "MaintenanceUrgency" NOT NULL DEFAULT 'UPCOMING',
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceScheduleEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fleet" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "organizationRegNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fleet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetVehicle" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "vehicleRecordId" TEXT NOT NULL,
    "assignedDriverId" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "FleetVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetDriver" (
    "id" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,

    CONSTRAINT "FleetDriver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastRetryAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleDocument" (
    "id" TEXT NOT NULL,
    "vehicleRecordId" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "issuer" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "fileUrl" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "sourceEntity" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "deadLettered" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventConsumerLog" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "consumer" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,

    CONSTRAINT "EventConsumerLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantFinanceTxn" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "TxnType" NOT NULL,
    "category" TEXT NOT NULL,
    "note" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "invoiceId" TEXT,
    "jobCardId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantFinanceTxn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_legacyShopId_key" ON "Tenant"("legacyShopId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantWorkingHour_tenantId_day_key" ON "TenantWorkingHour"("tenantId", "day");

-- CreateIndex
CREATE INDEX "TenantMembership_tenantId_role_idx" ON "TenantMembership"("tenantId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMembership_userId_tenantId_role_key" ON "TenantMembership"("userId", "tenantId", "role");

-- CreateIndex
CREATE INDEX "TenantService_tenantId_idx" ON "TenantService"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleRecord_vin_key" ON "VehicleRecord"("vin");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleRecord_chassisNumber_key" ON "VehicleRecord"("chassisNumber");

-- CreateIndex
CREATE INDEX "VehicleRecord_registrationPlate_idx" ON "VehicleRecord"("registrationPlate");

-- CreateIndex
CREATE INDEX "VehicleAuditEntry_vehicleRecordId_timestamp_idx" ON "VehicleAuditEntry"("vehicleRecordId", "timestamp");

-- CreateIndex
CREATE INDEX "OwnershipRecord_vehicleRecordId_startDate_idx" ON "OwnershipRecord"("vehicleRecordId", "startDate");

-- CreateIndex
CREATE INDEX "OwnershipRecord_userId_idx" ON "OwnershipRecord"("userId");

-- CreateIndex
CREATE INDEX "ServiceEvent_vehicleRecordId_completedAt_idx" ON "ServiceEvent"("vehicleRecordId", "completedAt");

-- CreateIndex
CREATE INDEX "ServiceEvent_tenantId_idx" ON "ServiceEvent"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "HealthScore_vehicleRecordId_key" ON "HealthScore"("vehicleRecordId");

-- CreateIndex
CREATE INDEX "JobCard_tenantId_status_idx" ON "JobCard"("tenantId", "status");

-- CreateIndex
CREATE INDEX "JobCard_vehicleRecordId_idx" ON "JobCard"("vehicleRecordId");

-- CreateIndex
CREATE INDEX "JobCard_customerId_idx" ON "JobCard"("customerId");

-- CreateIndex
CREATE INDEX "JobCard_scheduledAt_idx" ON "JobCard"("scheduledAt");

-- CreateIndex
CREATE INDEX "JobCardItem_jobCardId_idx" ON "JobCardItem"("jobCardId");

-- CreateIndex
CREATE INDEX "JobCardPart_jobCardId_idx" ON "JobCardPart"("jobCardId");

-- CreateIndex
CREATE INDEX "JobCardNote_jobCardId_idx" ON "JobCardNote"("jobCardId");

-- CreateIndex
CREATE INDEX "JobCardPhoto_jobCardId_idx" ON "JobCardPhoto"("jobCardId");

-- CreateIndex
CREATE INDEX "InventoryItem_tenantId_idx" ON "InventoryItem"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_tenantId_sku_key" ON "InventoryItem"("tenantId", "sku");

-- CreateIndex
CREATE INDEX "InventoryMovement_inventoryItemId_createdAt_idx" ON "InventoryMovement"("inventoryItemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_jobCardId_key" ON "Invoice"("jobCardId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_issuedAt_idx" ON "Invoice"("tenantId", "issuedAt");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_invoiceId_idx" ON "InvoiceLineItem"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoicePayment_invoiceId_idx" ON "InvoicePayment"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceTemplate_tenantId_make_model_key" ON "MaintenanceTemplate"("tenantId", "make", "model");

-- CreateIndex
CREATE INDEX "MaintenanceScheduleEntry_vehicleRecordId_completed_idx" ON "MaintenanceScheduleEntry"("vehicleRecordId", "completed");

-- CreateIndex
CREATE INDEX "Fleet_ownerId_idx" ON "Fleet"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "FleetVehicle_vehicleRecordId_key" ON "FleetVehicle"("vehicleRecordId");

-- CreateIndex
CREATE INDEX "FleetVehicle_fleetId_idx" ON "FleetVehicle"("fleetId");

-- CreateIndex
CREATE INDEX "FleetDriver_fleetId_idx" ON "FleetDriver"("fleetId");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_status_idx" ON "Notification"("status");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_eventType_channel_key" ON "NotificationPreference"("userId", "eventType", "channel");

-- CreateIndex
CREATE INDEX "VehicleDocument_vehicleRecordId_idx" ON "VehicleDocument"("vehicleRecordId");

-- CreateIndex
CREATE INDEX "VehicleDocument_expiryDate_idx" ON "VehicleDocument"("expiryDate");

-- CreateIndex
CREATE INDEX "OutboxEvent_published_createdAt_idx" ON "OutboxEvent"("published", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_deadLettered_idx" ON "OutboxEvent"("deadLettered");

-- CreateIndex
CREATE INDEX "EventConsumerLog_eventId_idx" ON "EventConsumerLog"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventConsumerLog_eventId_consumer_key" ON "EventConsumerLog"("eventId", "consumer");

-- CreateIndex
CREATE INDEX "TenantFinanceTxn_tenantId_date_idx" ON "TenantFinanceTxn"("tenantId", "date");

-- AddForeignKey
ALTER TABLE "TenantWorkingHour" ADD CONSTRAINT "TenantWorkingHour_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantService" ADD CONSTRAINT "TenantService_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleAuditEntry" ADD CONSTRAINT "VehicleAuditEntry_vehicleRecordId_fkey" FOREIGN KEY ("vehicleRecordId") REFERENCES "VehicleRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipRecord" ADD CONSTRAINT "OwnershipRecord_vehicleRecordId_fkey" FOREIGN KEY ("vehicleRecordId") REFERENCES "VehicleRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipRecord" ADD CONSTRAINT "OwnershipRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceEvent" ADD CONSTRAINT "ServiceEvent_vehicleRecordId_fkey" FOREIGN KEY ("vehicleRecordId") REFERENCES "VehicleRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthScore" ADD CONSTRAINT "HealthScore_vehicleRecordId_fkey" FOREIGN KEY ("vehicleRecordId") REFERENCES "VehicleRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCard" ADD CONSTRAINT "JobCard_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCard" ADD CONSTRAINT "JobCard_vehicleRecordId_fkey" FOREIGN KEY ("vehicleRecordId") REFERENCES "VehicleRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCardItem" ADD CONSTRAINT "JobCardItem_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCardItem" ADD CONSTRAINT "JobCardItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "TenantService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCardPart" ADD CONSTRAINT "JobCardPart_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCardPart" ADD CONSTRAINT "JobCardPart_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCardNote" ADD CONSTRAINT "JobCardNote_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCardPhoto" ADD CONSTRAINT "JobCardPhoto_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceTemplate" ADD CONSTRAINT "MaintenanceTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceScheduleEntry" ADD CONSTRAINT "MaintenanceScheduleEntry_vehicleRecordId_fkey" FOREIGN KEY ("vehicleRecordId") REFERENCES "VehicleRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetVehicle" ADD CONSTRAINT "FleetVehicle_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetVehicle" ADD CONSTRAINT "FleetVehicle_vehicleRecordId_fkey" FOREIGN KEY ("vehicleRecordId") REFERENCES "VehicleRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetDriver" ADD CONSTRAINT "FleetDriver_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDocument" ADD CONSTRAINT "VehicleDocument_vehicleRecordId_fkey" FOREIGN KEY ("vehicleRecordId") REFERENCES "VehicleRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantFinanceTxn" ADD CONSTRAINT "TenantFinanceTxn_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
