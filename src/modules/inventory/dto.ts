import { InventoryMovementType } from '@prisma/client';

// ─── Create Inventory Item ─────────────────────────────────────

export interface CreateInventoryItemDto {
  name: string; // max 120 chars
  sku: string; // max 40 chars
  category?: string;
  quantity: number; // >= 0
  unitCostPaise: number;
  sellingPricePaise: number;
  reorderThreshold?: number; // default 0
  preferredVendor?: string;
}

// ─── Update Inventory Item ─────────────────────────────────────

export interface UpdateInventoryItemDto {
  name?: string;
  sku?: string;
  category?: string;
  unitCostPaise?: number;
  sellingPricePaise?: number;
  reorderThreshold?: number;
  preferredVendor?: string;
}

// ─── Purchase ──────────────────────────────────────────────────

export interface PurchaseDto {
  quantity: number; // must be > 0
  unitCostPaise: number; // purchase unit cost
  referenceId?: string; // PO number
  notes?: string;
}

// ─── Consume ───────────────────────────────────────────────────

export interface ConsumeDto {
  quantity: number; // must be > 0
  referenceId?: string; // Job Card ID
  notes?: string;
}

// ─── Return ────────────────────────────────────────────────────

export interface ReturnDto {
  quantity: number; // must be > 0
  referenceId?: string;
  notes?: string;
}

// ─── Adjust ────────────────────────────────────────────────────

export interface AdjustDto {
  newQuantity: number; // >= 0, sets quantity directly
  notes?: string;
}
