import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InventoryMovementType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../common/providers/tenant-context.provider';
import { EventsService } from '../events/events.service';
import {
  EventTypes,
  type OutboxEventPayload,
  type JobCardCompletedPayload,
  type JobCardCancelledPayload,
} from '../events/event-types';
import { ApiException } from '../../common/api-exception';
import type {
  CreateInventoryItemDto,
  UpdateInventoryItemDto,
  PurchaseDto,
  ConsumeDto,
  ReturnDto,
  AdjustDto,
} from './dto';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly eventsService: EventsService,
  ) {}

  // ─── CRUD ────────────────────────────────────────────────────────

  /**
   * List all inventory items for the current tenant.
   */
  async list() {
    const tenantId = this.requireTenant();
    return this.prisma.inventoryItem.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Create a new inventory item, enforcing SKU uniqueness within tenant.
   */
  async create(dto: CreateInventoryItemDto) {
    const tenantId = this.requireTenant();

    // Validate name length
    if (!dto.name || dto.name.length > 120) {
      throw ApiException.validation('Name is required and must be at most 120 characters.');
    }

    // Validate SKU length
    if (!dto.sku || dto.sku.length > 40) {
      throw ApiException.validation('SKU is required and must be at most 40 characters.');
    }

    // Validate quantity >= 0
    if (dto.quantity < 0) {
      throw ApiException.validation('Quantity must be 0 or greater.');
    }

    // Enforce SKU uniqueness within tenant
    const existing = await this.prisma.inventoryItem.findUnique({
      where: { tenantId_sku: { tenantId, sku: dto.sku } },
    });
    if (existing) {
      throw ApiException.validation(`SKU "${dto.sku}" already exists in this tenant.`);
    }

    const item = await this.prisma.inventoryItem.create({
      data: {
        tenantId,
        name: dto.name,
        sku: dto.sku,
        category: dto.category || null,
        quantity: dto.quantity,
        unitCostPaise: dto.unitCostPaise,
        sellingPricePaise: dto.sellingPricePaise,
        reorderThreshold: dto.reorderThreshold ?? 0,
        preferredVendor: dto.preferredVendor || null,
      },
    });

    return item;
  }

  /**
   * Update an inventory item. Validates SKU uniqueness if SKU is being changed.
   */
  async update(id: string, dto: UpdateInventoryItemDto) {
    const tenantId = this.requireTenant();

    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, tenantId },
    });
    if (!item) {
      throw ApiException.notFound('Inventory item not found.');
    }

    // If SKU is being changed, enforce uniqueness
    if (dto.sku && dto.sku !== item.sku) {
      if (dto.sku.length > 40) {
        throw ApiException.validation('SKU must be at most 40 characters.');
      }
      const existing = await this.prisma.inventoryItem.findUnique({
        where: { tenantId_sku: { tenantId, sku: dto.sku } },
      });
      if (existing) {
        throw ApiException.validation(`SKU "${dto.sku}" already exists in this tenant.`);
      }
    }

    if (dto.name !== undefined && dto.name.length > 120) {
      throw ApiException.validation('Name must be at most 120 characters.');
    }

    const updated = await this.prisma.inventoryItem.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.sku !== undefined && { sku: dto.sku }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.unitCostPaise !== undefined && { unitCostPaise: dto.unitCostPaise }),
        ...(dto.sellingPricePaise !== undefined && { sellingPricePaise: dto.sellingPricePaise }),
        ...(dto.reorderThreshold !== undefined && { reorderThreshold: dto.reorderThreshold }),
        ...(dto.preferredVendor !== undefined && { preferredVendor: dto.preferredVendor }),
      },
    });

    return updated;
  }

  // ─── Stock Operations ────────────────────────────────────────────

  /**
   * Record a purchase: increase quantity + recalculate weighted average cost.
   * Formula: newCost = ((currentQty * currentCost) + (purchaseQty * purchaseCost)) / (currentQty + purchaseQty)
   */
  async purchase(id: string, dto: PurchaseDto, staffId: string) {
    const tenantId = this.requireTenant();

    if (dto.quantity <= 0) {
      throw ApiException.validation('Purchase quantity must be greater than 0.');
    }
    if (dto.unitCostPaise <= 0) {
      throw ApiException.validation('Purchase unit cost must be greater than 0.');
    }

    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, tenantId },
    });
    if (!item) {
      throw ApiException.notFound('Inventory item not found.');
    }

    // Weighted average cost calculation
    const newUnitCostPaise = this.calculateWeightedAverageCost(
      item.quantity,
      item.unitCostPaise,
      dto.quantity,
      dto.unitCostPaise,
    );

    const newQuantity = item.quantity + dto.quantity;

    // Update item and create movement in transaction
    const [updated] = await this.prisma.$transaction([
      this.prisma.inventoryItem.update({
        where: { id },
        data: {
          quantity: newQuantity,
          unitCostPaise: newUnitCostPaise,
        },
      }),
      this.prisma.inventoryMovement.create({
        data: {
          inventoryItemId: id,
          type: InventoryMovementType.PURCHASE,
          quantityDelta: dto.quantity,
          referenceId: dto.referenceId || null,
          staffId,
          notes: dto.notes || null,
        },
      }),
    ]);

    return updated;
  }

  /**
   * Manual consumption: decrease quantity, reject if below 0.
   */
  async consume(id: string, dto: ConsumeDto, staffId: string) {
    const tenantId = this.requireTenant();

    if (dto.quantity <= 0) {
      throw ApiException.validation('Consumption quantity must be greater than 0.');
    }

    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, tenantId },
    });
    if (!item) {
      throw ApiException.notFound('Inventory item not found.');
    }

    if (item.quantity - dto.quantity < 0) {
      throw ApiException.validation(
        `Insufficient stock. Current quantity: ${item.quantity}, requested: ${dto.quantity}.`,
      );
    }

    const newQuantity = item.quantity - dto.quantity;

    const [updated] = await this.prisma.$transaction([
      this.prisma.inventoryItem.update({
        where: { id },
        data: { quantity: newQuantity },
      }),
      this.prisma.inventoryMovement.create({
        data: {
          inventoryItemId: id,
          type: InventoryMovementType.CONSUMPTION,
          quantityDelta: -dto.quantity,
          referenceId: dto.referenceId || null,
          staffId,
          notes: dto.notes || null,
        },
      }),
    ]);

    // Check reorder threshold
    await this.checkReorderThreshold(item.id, newQuantity, item.reorderThreshold, tenantId, item.name);

    return updated;
  }

  /**
   * Return: increase quantity.
   */
  async return(id: string, dto: ReturnDto, staffId: string) {
    const tenantId = this.requireTenant();

    if (dto.quantity <= 0) {
      throw ApiException.validation('Return quantity must be greater than 0.');
    }

    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, tenantId },
    });
    if (!item) {
      throw ApiException.notFound('Inventory item not found.');
    }

    const newQuantity = item.quantity + dto.quantity;

    const [updated] = await this.prisma.$transaction([
      this.prisma.inventoryItem.update({
        where: { id },
        data: { quantity: newQuantity },
      }),
      this.prisma.inventoryMovement.create({
        data: {
          inventoryItemId: id,
          type: InventoryMovementType.RETURN,
          quantityDelta: dto.quantity,
          referenceId: dto.referenceId || null,
          staffId,
          notes: dto.notes || null,
        },
      }),
    ]);

    return updated;
  }

  /**
   * Adjustment: set quantity directly.
   */
  async adjust(id: string, dto: AdjustDto, staffId: string) {
    const tenantId = this.requireTenant();

    if (dto.newQuantity < 0) {
      throw ApiException.validation('Adjusted quantity must be 0 or greater.');
    }

    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, tenantId },
    });
    if (!item) {
      throw ApiException.notFound('Inventory item not found.');
    }

    const delta = dto.newQuantity - item.quantity;

    const [updated] = await this.prisma.$transaction([
      this.prisma.inventoryItem.update({
        where: { id },
        data: { quantity: dto.newQuantity },
      }),
      this.prisma.inventoryMovement.create({
        data: {
          inventoryItemId: id,
          type: InventoryMovementType.ADJUSTMENT,
          quantityDelta: delta,
          referenceId: null,
          staffId,
          notes: dto.notes || null,
        },
      }),
    ]);

    // Check reorder threshold after adjustment
    await this.checkReorderThreshold(item.id, dto.newQuantity, item.reorderThreshold, tenantId, item.name);

    return updated;
  }

  // ─── Reports ─────────────────────────────────────────────────────

  /**
   * Stock valuation report grouped by category.
   */
  async getValuationReport() {
    const tenantId = this.requireTenant();

    const items = await this.prisma.inventoryItem.findMany({
      where: { tenantId },
      select: {
        category: true,
        quantity: true,
        unitCostPaise: true,
      },
    });

    // Group by category and calculate total value
    const categoryMap = new Map<string, { totalValuePaise: number; itemCount: number; totalQuantity: number }>();

    for (const item of items) {
      const category = item.category || 'Uncategorized';
      const existing = categoryMap.get(category) || { totalValuePaise: 0, itemCount: 0, totalQuantity: 0 };
      existing.totalValuePaise += item.quantity * item.unitCostPaise;
      existing.itemCount += 1;
      existing.totalQuantity += item.quantity;
      categoryMap.set(category, existing);
    }

    const categories = Array.from(categoryMap.entries()).map(([category, data]) => ({
      category,
      ...data,
    }));

    const grandTotalPaise = categories.reduce((sum, c) => sum + c.totalValuePaise, 0);

    return { categories, grandTotalPaise };
  }

  /**
   * Movement audit trail for the current tenant.
   */
  async getMovements(itemId?: string, limit = 50, offset = 0) {
    const tenantId = this.requireTenant();

    const where: any = {
      inventoryItem: { tenantId },
    };
    if (itemId) {
      where.inventoryItemId = itemId;
    }

    const movements = await this.prisma.inventoryMovement.findMany({
      where,
      include: {
        inventoryItem: { select: { name: true, sku: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return movements;
  }

  // ─── Event Handlers ──────────────────────────────────────────────

  /**
   * Handle job-card.completed event: deduct parts consumed.
   */
  @OnEvent(EventTypes.JOB_CARD_COMPLETED)
  async handleJobCardCompleted(event: OutboxEventPayload<JobCardCompletedPayload> & { eventId: string }) {
    await this.eventsService.processWithIdempotency(
      event.eventId,
      'inventory.job-card-completed',
      async () => {
        const { partsConsumed, jobCardId, tenantId } = event.data;

        for (const part of partsConsumed) {
          const item = await this.prisma.inventoryItem.findUnique({
            where: { id: part.inventoryItemId },
          });

          if (!item) {
            this.logger.warn(
              `Inventory item ${part.inventoryItemId} not found for job card ${jobCardId}`,
            );
            continue;
          }

          if (item.quantity - part.quantity < 0) {
            this.logger.error(
              `Insufficient stock for item ${part.inventoryItemId} (qty: ${item.quantity}, requested: ${part.quantity}) in job card ${jobCardId}`,
            );
            throw new Error(
              `Insufficient stock for inventory item ${part.inventoryItemId}`,
            );
          }

          const newQuantity = item.quantity - part.quantity;

          await this.prisma.$transaction([
            this.prisma.inventoryItem.update({
              where: { id: part.inventoryItemId },
              data: { quantity: newQuantity },
            }),
            this.prisma.inventoryMovement.create({
              data: {
                inventoryItemId: part.inventoryItemId,
                type: InventoryMovementType.CONSUMPTION,
                quantityDelta: -part.quantity,
                referenceId: jobCardId,
                staffId: 'system',
                notes: `Auto-deducted from completed job card ${jobCardId}`,
              },
            }),
          ]);

          // Check reorder threshold
          await this.checkReorderThreshold(
            item.id,
            newQuantity,
            item.reorderThreshold,
            tenantId,
            item.name,
          );
        }

        this.logger.log(`Inventory deducted for completed job card ${jobCardId}`);
      },
    );
  }

  /**
   * Handle job-card.cancelled event: reverse parts.
   */
  @OnEvent(EventTypes.JOB_CARD_CANCELLED)
  async handleJobCardCancelled(event: OutboxEventPayload<JobCardCancelledPayload> & { eventId: string }) {
    await this.eventsService.processWithIdempotency(
      event.eventId,
      'inventory.job-card-cancelled',
      async () => {
        const { partsToReverse, jobCardId } = event.data;

        for (const part of partsToReverse) {
          await this.prisma.$transaction([
            this.prisma.inventoryItem.update({
              where: { id: part.inventoryItemId },
              data: { quantity: { increment: part.quantity } },
            }),
            this.prisma.inventoryMovement.create({
              data: {
                inventoryItemId: part.inventoryItemId,
                type: InventoryMovementType.RETURN,
                quantityDelta: part.quantity,
                referenceId: jobCardId,
                staffId: 'system',
                notes: `Auto-reversed from cancelled job card ${jobCardId}`,
              },
            }),
          ]);
        }

        this.logger.log(`Inventory reversed for cancelled job card ${jobCardId}`);
      },
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  /**
   * Weighted average cost calculation.
   * Returns rounded to nearest integer (paise).
   */
  calculateWeightedAverageCost(
    currentQuantity: number,
    currentUnitCost: number,
    purchasedQuantity: number,
    purchaseUnitCost: number,
  ): number {
    const totalValue = currentQuantity * currentUnitCost + purchasedQuantity * purchaseUnitCost;
    const totalQuantity = currentQuantity + purchasedQuantity;

    if (totalQuantity === 0) return 0;

    return Math.round(totalValue / totalQuantity);
  }

  /**
   * Check if item quantity <= reorder threshold and publish alert.
   */
  private async checkReorderThreshold(
    itemId: string,
    currentQuantity: number,
    reorderThreshold: number,
    tenantId: string,
    itemName: string,
  ): Promise<void> {
    if (currentQuantity <= reorderThreshold) {
      await this.eventsService.publish({
        eventType: EventTypes.INVENTORY_LOW_STOCK,
        sourceEntity: 'InventoryItem',
        sourceId: itemId,
        payload: {
          inventoryItemId: itemId,
          tenantId,
          name: itemName,
          currentQuantity,
          reorderThreshold,
        },
      });
    }
  }

  private requireTenant(): string {
    const tenantId = this.tenantContext.tenantId;
    if (!tenantId) {
      throw ApiException.validation('Tenant context is required.');
    }
    return tenantId;
  }
}
