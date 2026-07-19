import { Injectable } from '@nestjs/common';
import { JobCardStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../common/providers/tenant-context.provider';
import { EventsService } from '../events/events.service';
import { EventTypes } from '../events/event-types';
import { ApiException } from '../../common/api-exception';
import type {
  CreateJobCardDto,
  TransitionJobCardDto,
  LogPartsDto,
  AddNoteDto,
  CancelJobCardDto,
} from './dto';

/**
 * Valid forward transitions in the Job Card state machine.
 * Each key maps to the set of valid target statuses.
 */
const VALID_TRANSITIONS: Record<JobCardStatus, JobCardStatus[]> = {
  [JobCardStatus.CREATED]: [JobCardStatus.ASSIGNED, JobCardStatus.CANCELLED],
  [JobCardStatus.ASSIGNED]: [JobCardStatus.IN_PROGRESS, JobCardStatus.CANCELLED],
  [JobCardStatus.IN_PROGRESS]: [JobCardStatus.QUALITY_CHECK, JobCardStatus.CANCELLED],
  [JobCardStatus.QUALITY_CHECK]: [
    JobCardStatus.COMPLETED,
    JobCardStatus.IN_PROGRESS, // rework
    JobCardStatus.CANCELLED,
  ],
  [JobCardStatus.COMPLETED]: [JobCardStatus.INVOICED],
  [JobCardStatus.INVOICED]: [],
  [JobCardStatus.CANCELLED]: [],
};

@Injectable()
export class JobCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly eventsService: EventsService,
  ) {}

  /**
   * Create a new Job Card with 1-20 services from the tenant catalog.
   */
  async create(dto: CreateJobCardDto) {
    const tenantId = this.tenantContext.tenantId;
    if (!tenantId) {
      throw ApiException.validation('Tenant context is required.');
    }

    // Validate services array (1-20)
    if (!dto.services || dto.services.length === 0) {
      throw ApiException.validation('At least 1 service is required.');
    }
    if (dto.services.length > 20) {
      throw ApiException.validation('Maximum 20 services allowed per job card.');
    }

    // Validate vehicle record exists
    const vehicleRecord = await this.prisma.vehicleRecord.findUnique({
      where: { id: dto.vehicleRecordId },
    });
    if (!vehicleRecord) {
      throw ApiException.notFound('Vehicle record not found.');
    }

    // Validate all services belong to the tenant catalog
    const serviceIds = dto.services.map((s) => s.serviceId);
    const tenantServices = await this.prisma.tenantService.findMany({
      where: {
        id: { in: serviceIds },
        tenantId,
      },
    });
    if (tenantServices.length !== serviceIds.length) {
      throw ApiException.validation('One or more services not found in tenant catalog.');
    }

    // Create the job card with items in a transaction
    const jobCard = await this.prisma.$transaction(async (tx) => {
      const card = await tx.jobCard.create({
        data: {
          tenantId,
          vehicleRecordId: dto.vehicleRecordId,
          customerId: dto.customerId,
          status: JobCardStatus.CREATED,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
          notes: dto.notes || null,
        },
      });

      // Create job card items from selected services
      await tx.jobCardItem.createMany({
        data: tenantServices.map((svc) => ({
          jobCardId: card.id,
          serviceId: svc.id,
          pricePaise: svc.pricePaise,
          durationMin: svc.durationMin,
        })),
      });

      return card;
    });

    return this.findById(jobCard.id);
  }

  /**
   * List job cards for the current tenant, optionally filtered by status.
   * If no tenant context, falls back to filtering by customerId (customer view).
   */
  async list(status?: JobCardStatus, userId?: string) {
    const tenantId = this.tenantContext.tenantId;

    const where: any = {};
    if (tenantId) {
      where.tenantId = tenantId;
    } else if (userId) {
      where.customerId = userId;
    } else {
      return [];
    }
    if (status) where.status = status;

    return this.prisma.jobCard.findMany({
      where,
      include: {
        items: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a single job card with all relations.
   */
  async findById(id: string) {
    const jobCard = await this.prisma.jobCard.findUnique({
      where: { id },
      include: {
        items: true,
        partsConsumed: true,
        laborNotes: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!jobCard) {
      throw ApiException.notFound('Job card not found.');
    }

    return jobCard;
  }

  /**
   * Transition a job card to a new status, enforcing the state machine.
   */
  async transition(id: string, dto: TransitionJobCardDto) {
    const jobCard = await this.prisma.jobCard.findUnique({
      where: { id },
      include: { partsConsumed: true, items: true },
    });

    if (!jobCard) {
      throw ApiException.notFound('Job card not found.');
    }

    const { targetStatus } = dto;
    const currentStatus = jobCard.status;

    // Validate the transition is allowed
    const allowedTargets = VALID_TRANSITIONS[currentStatus];
    if (!allowedTargets.includes(targetStatus)) {
      throw ApiException.invalidTransition(
        `Cannot transition from ${currentStatus} to ${targetStatus}.`,
      );
    }

    // Build update data based on transition type
    const updateData: Record<string, unknown> = { status: targetStatus };

    // CREATED → ASSIGNED: require assignedTechId and estimatedCompletion
    if (currentStatus === JobCardStatus.CREATED && targetStatus === JobCardStatus.ASSIGNED) {
      if (!dto.assignedTechId) {
        throw ApiException.validation('assignedTechId is required for assignment.');
      }
      if (!dto.estimatedCompletion) {
        throw ApiException.validation('estimatedCompletion is required for assignment.');
      }
      const estimated = new Date(dto.estimatedCompletion);
      if (estimated <= new Date()) {
        throw ApiException.validation('estimatedCompletion must be a future datetime.');
      }
      updateData.assignedTechId = dto.assignedTechId;
      updateData.estimatedCompletion = estimated;
    }

    // QUALITY_CHECK → IN_PROGRESS: rework
    if (
      currentStatus === JobCardStatus.QUALITY_CHECK &&
      targetStatus === JobCardStatus.IN_PROGRESS
    ) {
      if (!dto.reworkReason) {
        throw ApiException.validation('reworkReason is required for rework transition.');
      }
      updateData.reworkReason = dto.reworkReason;
      updateData.reworkCount = jobCard.reworkCount + 1;
    }

    // Perform the transition
    const updated = await this.prisma.jobCard.update({
      where: { id },
      data: updateData,
    });

    // On COMPLETED: publish event
    if (targetStatus === JobCardStatus.COMPLETED) {
      await this.publishCompletedEvent(jobCard);
    }

    return updated;
  }

  /**
   * Log parts consumption for a job card (only while IN_PROGRESS).
   */
  async logParts(jobCardId: string, dto: LogPartsDto) {
    const jobCard = await this.prisma.jobCard.findUnique({
      where: { id: jobCardId },
    });

    if (!jobCard) {
      throw ApiException.notFound('Job card not found.');
    }

    if (jobCard.status !== JobCardStatus.IN_PROGRESS) {
      throw ApiException.invalidTransition('Parts can only be logged while job card is IN_PROGRESS.');
    }

    if (!dto.inventoryItemId || dto.quantity <= 0) {
      throw ApiException.validation('inventoryItemId and a positive quantity are required.');
    }

    // Validate inventory item exists
    const inventoryItem = await this.prisma.inventoryItem.findUnique({
      where: { id: dto.inventoryItemId },
    });
    if (!inventoryItem) {
      throw ApiException.notFound('Inventory item not found.');
    }

    const part = await this.prisma.jobCardPart.create({
      data: {
        jobCardId,
        inventoryItemId: dto.inventoryItemId,
        quantity: dto.quantity,
        unitCostPaise: inventoryItem.unitCostPaise,
      },
    });

    return part;
  }

  /**
   * Add a labor note to a job card (only while IN_PROGRESS).
   */
  async addNote(jobCardId: string, authorId: string, dto: AddNoteDto) {
    const jobCard = await this.prisma.jobCard.findUnique({
      where: { id: jobCardId },
    });

    if (!jobCard) {
      throw ApiException.notFound('Job card not found.');
    }

    if (jobCard.status !== JobCardStatus.IN_PROGRESS) {
      throw ApiException.invalidTransition('Notes can only be added while job card is IN_PROGRESS.');
    }

    if (!dto.content || dto.content.length === 0) {
      throw ApiException.validation('Note content is required.');
    }
    if (dto.content.length > 2000) {
      throw ApiException.validation('Note content must not exceed 2000 characters.');
    }

    const note = await this.prisma.jobCardNote.create({
      data: {
        jobCardId,
        authorId,
        content: dto.content,
      },
    });

    return note;
  }

  /**
   * Cancel a job card. If parts have been consumed, reverse inventory and require a reason.
   */
  async cancel(id: string, dto: CancelJobCardDto) {
    const jobCard = await this.prisma.jobCard.findUnique({
      where: { id },
      include: { partsConsumed: { where: { reversed: false } } },
    });

    if (!jobCard) {
      throw ApiException.notFound('Job card not found.');
    }

    // Can only cancel from CREATED, ASSIGNED, IN_PROGRESS, or QUALITY_CHECK
    const cancellableStatuses: JobCardStatus[] = [
      JobCardStatus.CREATED,
      JobCardStatus.ASSIGNED,
      JobCardStatus.IN_PROGRESS,
      JobCardStatus.QUALITY_CHECK,
    ];

    if (!cancellableStatuses.includes(jobCard.status)) {
      throw ApiException.invalidTransition(
        `Cannot cancel a job card in ${jobCard.status} status.`,
      );
    }

    // If parts have been consumed, require a cancellation reason
    const hasConsumedParts = jobCard.partsConsumed.length > 0;
    if (hasConsumedParts) {
      if (!dto.reason) {
        throw ApiException.validation(
          'Cancellation reason is required when parts have been consumed.',
        );
      }
      if (dto.reason.length < 1 || dto.reason.length > 500) {
        throw ApiException.validation('Cancellation reason must be 1-500 characters.');
      }
    }

    // Perform cancellation in a transaction
    const updated = await this.prisma.$transaction(async (tx) => {
      // Reverse consumed parts
      if (hasConsumedParts) {
        await tx.jobCardPart.updateMany({
          where: { jobCardId: id, reversed: false },
          data: {
            reversed: true,
            reversalReason: dto.reason,
          },
        });
      }

      // Update job card status
      return tx.jobCard.update({
        where: { id },
        data: {
          status: JobCardStatus.CANCELLED,
          cancellationReason: dto.reason || null,
        },
      });
    });

    // If parts were consumed, publish cancellation event
    if (hasConsumedParts) {
      await this.eventsService.publish({
        eventType: EventTypes.JOB_CARD_CANCELLED,
        sourceEntity: 'JobCard',
        sourceId: id,
        payload: {
          jobCardId: id,
          tenantId: jobCard.tenantId,
          vehicleRecordId: jobCard.vehicleRecordId,
          partsToReverse: jobCard.partsConsumed.map((p) => ({
            inventoryItemId: p.inventoryItemId,
            quantity: p.quantity,
          })),
          cancellationReason: dto.reason,
        },
      });
    }

    return updated;
  }

  /**
   * Publish the job-card.completed event with full payload.
   */
  private async publishCompletedEvent(
    jobCard: {
      id: string;
      tenantId: string;
      vehicleRecordId: string;
      customerId: string;
      assignedTechId: string | null;
      items: Array<{ serviceId: string; pricePaise: number }>;
      partsConsumed: Array<{ inventoryItemId: string; quantity: number; unitCostPaise: number }>;
    },
  ) {
    await this.eventsService.publish({
      eventType: EventTypes.JOB_CARD_COMPLETED,
      sourceEntity: 'JobCard',
      sourceId: jobCard.id,
      payload: {
        jobCardId: jobCard.id,
        tenantId: jobCard.tenantId,
        vehicleRecordId: jobCard.vehicleRecordId,
        customerId: jobCard.customerId,
        services: jobCard.items.map((item) => ({
          serviceId: item.serviceId,
          pricePaise: item.pricePaise,
        })),
        partsConsumed: jobCard.partsConsumed.map((p) => ({
          inventoryItemId: p.inventoryItemId,
          quantity: p.quantity,
          unitCostPaise: p.unitCostPaise,
        })),
        assignedTechId: jobCard.assignedTechId,
        completedAt: new Date().toISOString(),
      },
    });
  }
}
