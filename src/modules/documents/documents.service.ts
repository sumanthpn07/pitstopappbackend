import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api-exception';
import { EventsService } from '../events/events.service';
import { EventTypes } from '../events/event-types';
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  ALLOWED_PHOTO_MIME_TYPES,
  MAX_DOCUMENT_FILE_SIZE_BYTES,
  MAX_PHOTO_FILE_SIZE_BYTES,
  MAX_PHOTOS_PER_JOB_CARD,
  type CreateVehicleDocumentDto,
  type CreateJobCardPhotoDto,
} from './dto';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
  ) {}

  // ─── Vehicle Documents ───────────────────────────────────────────

  /**
   * Upload a document for a vehicle record.
   * Validates file size (max 10MB), MIME type (PDF/JPEG/PNG),
   * and enforces issueDate <= expiryDate.
   *
   * Documents are retained across ownership changes (Req 15.6).
   */
  async createDocument(vehicleRecordId: string, dto: CreateVehicleDocumentDto) {
    // Verify vehicle exists
    const vehicle = await this.prisma.vehicleRecord.findUnique({
      where: { id: vehicleRecordId },
    });
    if (!vehicle) {
      throw ApiException.notFound('Vehicle record not found.');
    }

    // Validate MIME type
    if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(dto.mimeType)) {
      throw ApiException.validation(
        `Unsupported file format. Allowed formats: PDF, JPEG, PNG.`,
      );
    }

    // Validate file size
    if (dto.fileSizeBytes > MAX_DOCUMENT_FILE_SIZE_BYTES) {
      throw ApiException.validation(
        `File size exceeds the maximum allowed size of 10 MB.`,
      );
    }

    // Validate issueDate <= expiryDate
    if (dto.expiryDate) {
      const issueDate = new Date(dto.issueDate);
      const expiryDate = new Date(dto.expiryDate);
      if (issueDate > expiryDate) {
        throw ApiException.validation(
          'Issue date must not be after expiry date.',
        );
      }
    }

    const document = await this.prisma.vehicleDocument.create({
      data: {
        vehicleRecordId,
        documentType: dto.documentType,
        issuer: dto.issuer?.trim() || null,
        issueDate: new Date(dto.issueDate),
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        fileUrl: dto.fileUrl,
        fileSizeBytes: dto.fileSizeBytes,
        mimeType: dto.mimeType,
      },
    });

    return document;
  }

  /**
   * List all documents for a vehicle record.
   * Accessible to the vehicle owner regardless of ownership changes (Req 15.6, 15.7).
   */
  async listDocuments(vehicleRecordId: string) {
    // Verify vehicle exists
    const vehicle = await this.prisma.vehicleRecord.findUnique({
      where: { id: vehicleRecordId },
    });
    if (!vehicle) {
      throw ApiException.notFound('Vehicle record not found.');
    }

    return this.prisma.vehicleDocument.findMany({
      where: { vehicleRecordId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Job Card Photos ─────────────────────────────────────────────

  /**
   * Upload a photo to a job card.
   * Validates: max 20 per job card, 5MB max, JPEG/PNG only, before/after kind.
   */
  async createPhoto(jobCardId: string, dto: CreateJobCardPhotoDto) {
    // Verify job card exists
    const jobCard = await this.prisma.jobCard.findUnique({
      where: { id: jobCardId },
    });
    if (!jobCard) {
      throw ApiException.notFound('Job card not found.');
    }

    // Validate kind
    if (dto.kind !== 'before' && dto.kind !== 'after') {
      throw ApiException.validation(
        `Photo kind must be either "before" or "after".`,
      );
    }

    // Validate MIME type
    if (!ALLOWED_PHOTO_MIME_TYPES.includes(dto.mimeType)) {
      throw ApiException.validation(
        `Unsupported photo format. Allowed formats: JPEG, PNG.`,
      );
    }

    // Validate file size
    if (dto.fileSizeBytes > MAX_PHOTO_FILE_SIZE_BYTES) {
      throw ApiException.validation(
        `Photo size exceeds the maximum allowed size of 5 MB.`,
      );
    }

    // Validate max photos per job card
    const currentPhotoCount = await this.prisma.jobCardPhoto.count({
      where: { jobCardId },
    });
    if (currentPhotoCount >= MAX_PHOTOS_PER_JOB_CARD) {
      throw ApiException.validation(
        `Maximum of ${MAX_PHOTOS_PER_JOB_CARD} photos per job card has been reached.`,
      );
    }

    const photo = await this.prisma.jobCardPhoto.create({
      data: {
        jobCardId,
        url: dto.url,
        caption: dto.caption?.trim() || null,
        kind: dto.kind,
      },
    });

    return photo;
  }

  /**
   * List all photos for a job card.
   */
  async listPhotos(jobCardId: string) {
    const jobCard = await this.prisma.jobCard.findUnique({
      where: { id: jobCardId },
    });
    if (!jobCard) {
      throw ApiException.notFound('Job card not found.');
    }

    return this.prisma.jobCardPhoto.findMany({
      where: { jobCardId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ─── Expiry Reminder Scheduled Task ─────────────────────────────

  /**
   * Checks for documents expiring within 30 days and sends reminder notifications.
   * Runs daily at 9:00 AM.
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async checkDocumentExpiry(): Promise<void> {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Find documents expiring within the next 30 days that haven't expired yet
    const expiringDocuments = await this.prisma.vehicleDocument.findMany({
      where: {
        expiryDate: {
          gte: now,
          lte: thirtyDaysFromNow,
        },
      },
      include: {
        vehicleRecord: {
          include: {
            ownershipRecords: {
              where: {
                endDate: null,
                transferStatus: 'CONFIRMED',
              },
              select: { userId: true },
            },
          },
        },
      },
    });

    for (const doc of expiringDocuments) {
      // Find current owner
      const currentOwner = doc.vehicleRecord.ownershipRecords.find((o) => o.userId);
      if (!currentOwner?.userId) continue;

      // Publish expiry reminder event
      try {
        await this.eventsService.publish({
          eventType: EventTypes.DOCUMENT_EXPIRY_REMINDER,
          sourceEntity: 'VehicleDocument',
          sourceId: doc.id,
          payload: {
            documentId: doc.id,
            vehicleRecordId: doc.vehicleRecordId,
            userId: currentOwner.userId,
            documentType: doc.documentType,
            expiryDate: doc.expiryDate!.toISOString(),
          },
        });
      } catch (error) {
        this.logger.error(
          `Failed to publish expiry reminder for document ${doc.id}: ${error}`,
        );
      }
    }

    if (expiringDocuments.length > 0) {
      this.logger.log(
        `Published ${expiringDocuments.length} document expiry reminder(s).`,
      );
    }
  }
}
