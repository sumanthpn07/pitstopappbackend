import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DocumentsService } from './documents.service';
import type { CreateVehicleDocumentDto, CreateJobCardPhotoDto } from './dto';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let mockPrisma: any;
  let mockEventsService: any;

  beforeEach(() => {
    mockPrisma = {
      vehicleRecord: {
        findUnique: vi.fn(),
      },
      vehicleDocument: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      jobCard: {
        findUnique: vi.fn(),
      },
      jobCardPhoto: {
        create: vi.fn(),
        count: vi.fn(),
        findMany: vi.fn(),
      },
    };
    mockEventsService = {
      publish: vi.fn().mockResolvedValue('event-id'),
    };
    service = new DocumentsService(mockPrisma, mockEventsService);
  });

  // ─── Vehicle Documents ───────────────────────────────────────────

  describe('createDocument', () => {
    const validDto: CreateVehicleDocumentDto = {
      documentType: 'INSURANCE' as any,
      issuer: 'ICICI Lombard',
      issueDate: '2024-01-01',
      expiryDate: '2025-01-01',
      fileUrl: 'https://storage.example.com/doc.pdf',
      fileSizeBytes: 1024 * 1024, // 1MB
      mimeType: 'application/pdf',
    };

    it('creates a document for an existing vehicle', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: 'vr-1' });
      mockPrisma.vehicleDocument.create.mockResolvedValue({
        id: 'doc-1',
        vehicleRecordId: 'vr-1',
        documentType: 'INSURANCE',
        issuer: 'ICICI Lombard',
        issueDate: new Date('2024-01-01'),
        expiryDate: new Date('2025-01-01'),
        fileUrl: 'https://storage.example.com/doc.pdf',
        fileSizeBytes: 1024 * 1024,
        mimeType: 'application/pdf',
        createdAt: new Date(),
      });

      const result = await service.createDocument('vr-1', validDto);

      expect(result.id).toBe('doc-1');
      expect(result.documentType).toBe('INSURANCE');
      expect(mockPrisma.vehicleDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          vehicleRecordId: 'vr-1',
          documentType: 'INSURANCE',
          issuer: 'ICICI Lombard',
          mimeType: 'application/pdf',
        }),
      });
    });

    it('throws not found when vehicle does not exist', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue(null);

      await expect(
        service.createDocument('nonexistent', validDto),
      ).rejects.toThrow('Vehicle record not found');
    });

    it('rejects unsupported MIME type', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: 'vr-1' });

      const dto = { ...validDto, mimeType: 'application/zip' };
      await expect(
        service.createDocument('vr-1', dto),
      ).rejects.toThrow('Unsupported file format');
    });

    it('rejects file exceeding 10MB', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: 'vr-1' });

      const dto = { ...validDto, fileSizeBytes: 11 * 1024 * 1024 };
      await expect(
        service.createDocument('vr-1', dto),
      ).rejects.toThrow('exceeds the maximum allowed size of 10 MB');
    });

    it('rejects when issue date is after expiry date', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: 'vr-1' });

      const dto = { ...validDto, issueDate: '2025-06-01', expiryDate: '2024-01-01' };
      await expect(
        service.createDocument('vr-1', dto),
      ).rejects.toThrow('Issue date must not be after expiry date');
    });

    it('allows document without expiry date', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: 'vr-1' });
      mockPrisma.vehicleDocument.create.mockResolvedValue({
        id: 'doc-2',
        vehicleRecordId: 'vr-1',
        documentType: 'WARRANTY',
        expiryDate: null,
      });

      const dto = { ...validDto, expiryDate: undefined, documentType: 'WARRANTY' as any };
      const result = await service.createDocument('vr-1', dto);

      expect(result.expiryDate).toBeNull();
    });

    it('accepts JPEG MIME type', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: 'vr-1' });
      mockPrisma.vehicleDocument.create.mockResolvedValue({
        id: 'doc-3',
        mimeType: 'image/jpeg',
      });

      const dto = { ...validDto, mimeType: 'image/jpeg' };
      await service.createDocument('vr-1', dto);

      expect(mockPrisma.vehicleDocument.create).toHaveBeenCalled();
    });

    it('accepts PNG MIME type', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: 'vr-1' });
      mockPrisma.vehicleDocument.create.mockResolvedValue({
        id: 'doc-4',
        mimeType: 'image/png',
      });

      const dto = { ...validDto, mimeType: 'image/png' };
      await service.createDocument('vr-1', dto);

      expect(mockPrisma.vehicleDocument.create).toHaveBeenCalled();
    });

    it('accepts issue date equal to expiry date', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: 'vr-1' });
      mockPrisma.vehicleDocument.create.mockResolvedValue({
        id: 'doc-5',
        issueDate: new Date('2024-06-01'),
        expiryDate: new Date('2024-06-01'),
      });

      const dto = { ...validDto, issueDate: '2024-06-01', expiryDate: '2024-06-01' };
      const result = await service.createDocument('vr-1', dto);

      expect(result).toBeDefined();
    });

    it('trims issuer whitespace', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: 'vr-1' });
      mockPrisma.vehicleDocument.create.mockResolvedValue({ id: 'doc-6' });

      const dto = { ...validDto, issuer: '  ICICI Lombard  ' };
      await service.createDocument('vr-1', dto);

      expect(mockPrisma.vehicleDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ issuer: 'ICICI Lombard' }),
      });
    });
  });

  describe('listDocuments', () => {
    it('returns documents for an existing vehicle', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue({ id: 'vr-1' });
      const docs = [
        { id: 'doc-1', documentType: 'INSURANCE', createdAt: new Date() },
        { id: 'doc-2', documentType: 'REGISTRATION', createdAt: new Date() },
      ];
      mockPrisma.vehicleDocument.findMany.mockResolvedValue(docs);

      const result = await service.listDocuments('vr-1');

      expect(result).toHaveLength(2);
      expect(mockPrisma.vehicleDocument.findMany).toHaveBeenCalledWith({
        where: { vehicleRecordId: 'vr-1' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('throws not found for non-existent vehicle', async () => {
      mockPrisma.vehicleRecord.findUnique.mockResolvedValue(null);

      await expect(
        service.listDocuments('nonexistent'),
      ).rejects.toThrow('Vehicle record not found');
    });
  });

  // ─── Job Card Photos ─────────────────────────────────────────────

  describe('createPhoto', () => {
    const validPhotoDto: CreateJobCardPhotoDto = {
      url: 'https://storage.example.com/photo.jpg',
      caption: 'Front bumper damage',
      kind: 'before',
      fileSizeBytes: 2 * 1024 * 1024, // 2MB
      mimeType: 'image/jpeg',
    };

    it('creates a photo for an existing job card', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({ id: 'jc-1' });
      mockPrisma.jobCardPhoto.count.mockResolvedValue(0);
      mockPrisma.jobCardPhoto.create.mockResolvedValue({
        id: 'photo-1',
        jobCardId: 'jc-1',
        url: 'https://storage.example.com/photo.jpg',
        caption: 'Front bumper damage',
        kind: 'before',
        createdAt: new Date(),
      });

      const result = await service.createPhoto('jc-1', validPhotoDto);

      expect(result.id).toBe('photo-1');
      expect(result.kind).toBe('before');
    });

    it('throws not found when job card does not exist', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue(null);

      await expect(
        service.createPhoto('nonexistent', validPhotoDto),
      ).rejects.toThrow('Job card not found');
    });

    it('rejects invalid kind value', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({ id: 'jc-1' });

      const dto = { ...validPhotoDto, kind: 'during' };
      await expect(
        service.createPhoto('jc-1', dto),
      ).rejects.toThrow('must be either "before" or "after"');
    });

    it('rejects unsupported photo MIME type', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({ id: 'jc-1' });

      const dto = { ...validPhotoDto, mimeType: 'application/pdf' };
      await expect(
        service.createPhoto('jc-1', dto),
      ).rejects.toThrow('Unsupported photo format');
    });

    it('rejects photo exceeding 5MB', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({ id: 'jc-1' });

      const dto = { ...validPhotoDto, fileSizeBytes: 6 * 1024 * 1024 };
      await expect(
        service.createPhoto('jc-1', dto),
      ).rejects.toThrow('exceeds the maximum allowed size of 5 MB');
    });

    it('rejects when max photos per job card is reached', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({ id: 'jc-1' });
      mockPrisma.jobCardPhoto.count.mockResolvedValue(20);

      await expect(
        service.createPhoto('jc-1', validPhotoDto),
      ).rejects.toThrow('Maximum of 20 photos per job card');
    });

    it('allows up to 20 photos', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({ id: 'jc-1' });
      mockPrisma.jobCardPhoto.count.mockResolvedValue(19);
      mockPrisma.jobCardPhoto.create.mockResolvedValue({
        id: 'photo-20',
        jobCardId: 'jc-1',
        kind: 'after',
      });

      const result = await service.createPhoto('jc-1', { ...validPhotoDto, kind: 'after' });

      expect(result.id).toBe('photo-20');
    });

    it('accepts "after" kind', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({ id: 'jc-1' });
      mockPrisma.jobCardPhoto.count.mockResolvedValue(5);
      mockPrisma.jobCardPhoto.create.mockResolvedValue({
        id: 'photo-after',
        kind: 'after',
      });

      const dto = { ...validPhotoDto, kind: 'after' };
      const result = await service.createPhoto('jc-1', dto);

      expect(result.kind).toBe('after');
    });

    it('accepts PNG format', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({ id: 'jc-1' });
      mockPrisma.jobCardPhoto.count.mockResolvedValue(0);
      mockPrisma.jobCardPhoto.create.mockResolvedValue({ id: 'photo-png' });

      const dto = { ...validPhotoDto, mimeType: 'image/png' };
      await service.createPhoto('jc-1', dto);

      expect(mockPrisma.jobCardPhoto.create).toHaveBeenCalled();
    });

    it('trims caption whitespace', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({ id: 'jc-1' });
      mockPrisma.jobCardPhoto.count.mockResolvedValue(0);
      mockPrisma.jobCardPhoto.create.mockResolvedValue({ id: 'photo-trim' });

      const dto = { ...validPhotoDto, caption: '  Front bumper  ' };
      await service.createPhoto('jc-1', dto);

      expect(mockPrisma.jobCardPhoto.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ caption: 'Front bumper' }),
      });
    });
  });

  describe('listPhotos', () => {
    it('returns photos for an existing job card', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue({ id: 'jc-1' });
      const photos = [
        { id: 'p-1', kind: 'before', createdAt: new Date() },
        { id: 'p-2', kind: 'after', createdAt: new Date() },
      ];
      mockPrisma.jobCardPhoto.findMany.mockResolvedValue(photos);

      const result = await service.listPhotos('jc-1');

      expect(result).toHaveLength(2);
      expect(mockPrisma.jobCardPhoto.findMany).toHaveBeenCalledWith({
        where: { jobCardId: 'jc-1' },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('throws not found for non-existent job card', async () => {
      mockPrisma.jobCard.findUnique.mockResolvedValue(null);

      await expect(
        service.listPhotos('nonexistent'),
      ).rejects.toThrow('Job card not found');
    });
  });

  // ─── Expiry Reminder ─────────────────────────────────────────────

  describe('checkDocumentExpiry', () => {
    it('publishes expiry reminder events for documents expiring within 30 days', async () => {
      const expiringDoc = {
        id: 'doc-1',
        vehicleRecordId: 'vr-1',
        documentType: 'INSURANCE',
        expiryDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
        vehicleRecord: {
          ownershipRecords: [{ userId: 'user-1' }],
        },
      };

      mockPrisma.vehicleDocument.findMany.mockResolvedValue([expiringDoc]);

      await service.checkDocumentExpiry();

      expect(mockEventsService.publish).toHaveBeenCalledWith({
        eventType: 'document.expiry-reminder',
        sourceEntity: 'VehicleDocument',
        sourceId: 'doc-1',
        payload: expect.objectContaining({
          documentId: 'doc-1',
          vehicleRecordId: 'vr-1',
          userId: 'user-1',
          documentType: 'INSURANCE',
        }),
      });
    });

    it('skips documents with no current owner', async () => {
      const expiringDoc = {
        id: 'doc-2',
        vehicleRecordId: 'vr-2',
        documentType: 'REGISTRATION',
        expiryDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        vehicleRecord: {
          ownershipRecords: [], // No current owner
        },
      };

      mockPrisma.vehicleDocument.findMany.mockResolvedValue([expiringDoc]);

      await service.checkDocumentExpiry();

      expect(mockEventsService.publish).not.toHaveBeenCalled();
    });

    it('does not publish events when no documents are expiring', async () => {
      mockPrisma.vehicleDocument.findMany.mockResolvedValue([]);

      await service.checkDocumentExpiry();

      expect(mockEventsService.publish).not.toHaveBeenCalled();
    });
  });
});
