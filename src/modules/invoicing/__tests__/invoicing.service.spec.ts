import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InvoicingService } from '../invoicing.service';
import { InvoiceStatus, JobCardStatus, PaymentMethod } from '@prisma/client';
import { EventTypes } from '../../events/event-types';

describe('InvoicingService', () => {
  let service: InvoicingService;
  let mockPrisma: any;
  let mockTenantContext: any;
  let mockEventsService: any;

  const tenantId = 'tenant-1';
  const mockTenant = {
    id: tenantId,
    name: 'Test Garage',
    gstRate: 18,
    gstin: 'GSTIN123',
    contactPhone: '9876543210',
    address: '123 Main St',
  };

  const mockCustomer = {
    id: 'cust-1',
    name: 'John Doe',
    phone: '9876543210',
  };

  const mockVehicleRecord = {
    id: 'vr-1',
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
    registrationPlate: 'KA01AB1234',
  };

  const mockJobCard = {
    id: 'jc-1',
    tenantId,
    vehicleRecordId: 'vr-1',
    customerId: 'cust-1',
    status: JobCardStatus.COMPLETED,
    vehicleRecord: mockVehicleRecord,
    items: [
      {
        id: 'item-1',
        serviceId: 'svc-1',
        pricePaise: 50000,
        durationMin: 30,
        service: { name: 'Oil Change' },
      },
      {
        id: 'item-2',
        serviceId: 'svc-2',
        pricePaise: 100000,
        durationMin: 60,
        service: { name: 'Brake Service' },
      },
    ],
    partsConsumed: [
      {
        id: 'part-1',
        inventoryItemId: 'inv-1',
        quantity: 2,
        unitCostPaise: 15000,
        reversed: false,
        inventoryItem: { name: 'Brake Pad' },
      },
    ],
  };

  beforeEach(() => {
    mockPrisma = {
      jobCard: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      invoice: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      invoiceLineItem: {
        createMany: vi.fn(),
      },
      invoicePayment: {
        create: vi.fn(),
      },
      tenant: {
        findUnique: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
      tenantFinanceTxn: {
        create: vi.fn(),
      },
      $transaction: vi.fn(),
    };

    mockTenantContext = { tenantId };
    mockEventsService = {
      publish: vi.fn().mockResolvedValue('event-1'),
    };

    service = new InvoicingService(mockPrisma, mockTenantContext, mockEventsService);
  });

  // ─── Invoice Generation ──────────────────────────────────────────

  describe('generate', () => {
    it('generates invoice from completed job card with correct arithmetic', async () => {
      mockPrisma.jobCard.findFirst.mockResolvedValue(mockJobCard);
      mockPrisma.invoice.findUnique.mockResolvedValue(null); // no existing invoice
      mockPrisma.tenant.findUnique.mockResolvedValue(mockTenant);
      mockPrisma.user.findUnique.mockResolvedValue(mockCustomer);
      mockPrisma.invoice.count.mockResolvedValue(0); // first invoice of FY

      const expectedSubtotal = 50000 + 100000 + (2 * 15000); // 180000
      const expectedTax = Math.round(180000 * (18 / 100)); // 32400
      const expectedTotal = 180000 + 32400; // 212400

      // Mock the transaction to return the created invoice
      const createdInvoice = {
        id: 'inv-1',
        tenantId,
        jobCardId: 'jc-1',
        invoiceNumber: 'TEN-2024-001',
        customerId: 'cust-1',
        customerName: 'John Doe',
        customerPhone: '9876543210',
        vehicleSummary: 'Toyota Camry 2022 - KA01AB1234',
        subtotalPaise: expectedSubtotal,
        taxPaise: expectedTax,
        totalPaise: expectedTotal,
        status: InvoiceStatus.ISSUED,
        issuedAt: new Date(),
        createdAt: new Date(),
      };
      mockPrisma.$transaction.mockResolvedValue(createdInvoice);
      mockPrisma.invoice.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
        ...createdInvoice,
        lineItems: [],
        payments: [],
      });

      const result = await service.generate({ jobCardId: 'jc-1' });

      expect(result.subtotalPaise).toBe(expectedSubtotal);
      expect(result.taxPaise).toBe(expectedTax);
      expect(result.totalPaise).toBe(expectedTotal);
    });

    it('rejects when job card is not in COMPLETED status', async () => {
      mockPrisma.jobCard.findFirst.mockResolvedValue({
        ...mockJobCard,
        status: JobCardStatus.IN_PROGRESS,
      });

      await expect(
        service.generate({ jobCardId: 'jc-1' }),
      ).rejects.toThrow('Must be COMPLETED');
    });

    it('rejects when job card not found', async () => {
      mockPrisma.jobCard.findFirst.mockResolvedValue(null);

      await expect(
        service.generate({ jobCardId: 'nonexistent' }),
      ).rejects.toThrow('Job card not found');
    });

    it('rejects when invoice already exists for job card', async () => {
      mockPrisma.jobCard.findFirst.mockResolvedValue(mockJobCard);
      mockPrisma.invoice.findUnique.mockResolvedValue({ id: 'existing-invoice' });

      await expect(
        service.generate({ jobCardId: 'jc-1' }),
      ).rejects.toThrow('already exists');
    });

    it('rejects when no line items exist', async () => {
      mockPrisma.jobCard.findFirst.mockResolvedValue({
        ...mockJobCard,
        items: [],
        partsConsumed: [],
      });
      mockPrisma.invoice.findUnique.mockResolvedValue(null);
      mockPrisma.tenant.findUnique.mockResolvedValue(mockTenant);
      mockPrisma.user.findUnique.mockResolvedValue(mockCustomer);

      await expect(
        service.generate({ jobCardId: 'jc-1' }),
      ).rejects.toThrow('No line items');
    });

    it('rejects when customer not found', async () => {
      mockPrisma.jobCard.findFirst.mockResolvedValue(mockJobCard);
      mockPrisma.invoice.findUnique.mockResolvedValue(null);
      mockPrisma.tenant.findUnique.mockResolvedValue(mockTenant);
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.generate({ jobCardId: 'jc-1' }),
      ).rejects.toThrow('Customer not found');
    });

    it('publishes invoice.generated event after creation', async () => {
      mockPrisma.jobCard.findFirst.mockResolvedValue(mockJobCard);
      mockPrisma.invoice.findUnique.mockResolvedValueOnce(null);
      mockPrisma.tenant.findUnique.mockResolvedValue(mockTenant);
      mockPrisma.user.findUnique.mockResolvedValue(mockCustomer);
      mockPrisma.invoice.count.mockResolvedValue(0);

      const createdInvoice = {
        id: 'inv-1',
        tenantId,
        jobCardId: 'jc-1',
        totalPaise: 212400,
        status: InvoiceStatus.ISSUED,
      };
      mockPrisma.$transaction.mockResolvedValue(createdInvoice);
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({
        ...createdInvoice,
        lineItems: [],
        payments: [],
        invoiceNumber: 'TEN-2024-001',
        subtotalPaise: 180000,
        taxPaise: 32400,
      });

      await service.generate({ jobCardId: 'jc-1' });

      expect(mockEventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: EventTypes.INVOICE_GENERATED,
          sourceEntity: 'Invoice',
          payload: expect.objectContaining({
            invoiceId: 'inv-1',
            tenantId,
            jobCardId: 'jc-1',
            customerId: 'cust-1',
          }),
        }),
      );
    });
  });

  // ─── Payment Recording ───────────────────────────────────────────

  describe('recordPayment', () => {
    const mockInvoice = {
      id: 'inv-1',
      tenantId,
      invoiceNumber: 'TEN-2024-001',
      customerId: 'cust-1',
      totalPaise: 200000,
      status: InvoiceStatus.ISSUED,
      payments: [],
    };

    it('records a full payment and marks PAID', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(mockInvoice);
      const payment = {
        id: 'pay-1',
        invoiceId: 'inv-1',
        amountPaise: 200000,
        method: PaymentMethod.CASH,
        reference: null,
      };
      mockPrisma.$transaction.mockResolvedValue([payment, {}]);

      const result = await service.recordPayment('inv-1', {
        amountPaise: 200000,
        method: PaymentMethod.CASH,
      });

      expect(result.invoiceStatus).toBe(InvoiceStatus.PAID);
      expect(result.paidPaise).toBe(200000);
      expect(result.remainingPaise).toBe(0);
    });

    it('records a partial payment and marks PARTIALLY_PAID', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(mockInvoice);
      const payment = {
        id: 'pay-1',
        invoiceId: 'inv-1',
        amountPaise: 100000,
        method: PaymentMethod.UPI,
        reference: 'UPI-REF-123',
      };
      mockPrisma.$transaction.mockResolvedValue([payment, {}]);

      const result = await service.recordPayment('inv-1', {
        amountPaise: 100000,
        method: PaymentMethod.UPI,
        reference: 'UPI-REF-123',
      });

      expect(result.invoiceStatus).toBe(InvoiceStatus.PARTIALLY_PAID);
      expect(result.paidPaise).toBe(100000);
      expect(result.remainingPaise).toBe(100000);
    });

    it('allows split payment that completes the invoice', async () => {
      const invoiceWithPartialPayment = {
        ...mockInvoice,
        status: InvoiceStatus.PARTIALLY_PAID,
        payments: [
          { id: 'pay-1', amountPaise: 100000, method: PaymentMethod.CASH },
        ],
      };
      mockPrisma.invoice.findFirst.mockResolvedValue(invoiceWithPartialPayment);
      const payment = {
        id: 'pay-2',
        invoiceId: 'inv-1',
        amountPaise: 100000,
        method: PaymentMethod.CARD,
      };
      mockPrisma.$transaction.mockResolvedValue([payment, {}]);

      const result = await service.recordPayment('inv-1', {
        amountPaise: 100000,
        method: PaymentMethod.CARD,
      });

      expect(result.invoiceStatus).toBe(InvoiceStatus.PAID);
      expect(result.paidPaise).toBe(200000);
      expect(result.remainingPaise).toBe(0);
    });

    it('rejects payment on already paid invoice', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        ...mockInvoice,
        status: InvoiceStatus.PAID,
      });

      await expect(
        service.recordPayment('inv-1', {
          amountPaise: 10000,
          method: PaymentMethod.CASH,
        }),
      ).rejects.toThrow('already fully paid');
    });

    it('rejects payment on cancelled invoice', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        ...mockInvoice,
        status: InvoiceStatus.CANCELLED,
      });

      await expect(
        service.recordPayment('inv-1', {
          amountPaise: 10000,
          method: PaymentMethod.CASH,
        }),
      ).rejects.toThrow('cancelled invoice');
    });

    it('rejects payment exceeding remaining balance', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(mockInvoice);

      await expect(
        service.recordPayment('inv-1', {
          amountPaise: 300000,
          method: PaymentMethod.CASH,
        }),
      ).rejects.toThrow('exceeds remaining balance');
    });

    it('rejects when max payments (4) reached', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({
        ...mockInvoice,
        totalPaise: 1000000,
        payments: [
          { id: 'p1', amountPaise: 100000 },
          { id: 'p2', amountPaise: 100000 },
          { id: 'p3', amountPaise: 100000 },
          { id: 'p4', amountPaise: 100000 },
        ],
      });

      await expect(
        service.recordPayment('inv-1', {
          amountPaise: 100000,
          method: PaymentMethod.CASH,
        }),
      ).rejects.toThrow('Maximum 4 payments');
    });

    it('rejects zero amount payment', async () => {
      await expect(
        service.recordPayment('inv-1', {
          amountPaise: 0,
          method: PaymentMethod.CASH,
        }),
      ).rejects.toThrow('greater than 0');
    });

    it('rejects negative amount payment', async () => {
      await expect(
        service.recordPayment('inv-1', {
          amountPaise: -100,
          method: PaymentMethod.CASH,
        }),
      ).rejects.toThrow('greater than 0');
    });

    it('publishes invoice.paid event on full payment', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(mockInvoice);
      mockPrisma.$transaction.mockResolvedValue([
        { id: 'pay-1', amountPaise: 200000, method: PaymentMethod.CASH },
        {},
      ]);

      await service.recordPayment('inv-1', {
        amountPaise: 200000,
        method: PaymentMethod.CASH,
      });

      expect(mockEventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: EventTypes.INVOICE_PAID,
          payload: expect.objectContaining({
            invoiceId: 'inv-1',
            tenantId,
            customerId: 'cust-1',
            totalPaise: 200000,
          }),
        }),
      );
    });

    it('does not publish invoice.paid event on partial payment', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(mockInvoice);
      mockPrisma.$transaction.mockResolvedValue([
        { id: 'pay-1', amountPaise: 50000, method: PaymentMethod.UPI },
        {},
      ]);

      await service.recordPayment('inv-1', {
        amountPaise: 50000,
        method: PaymentMethod.UPI,
      });

      expect(mockEventsService.publish).not.toHaveBeenCalled();
    });
  });

  // ─── Invoice Number Generation ───────────────────────────────────

  describe('generateInvoiceNumber', () => {
    it('generates sequential number for first invoice of FY', async () => {
      mockPrisma.invoice.count.mockResolvedValue(0);

      const result = await service.generateInvoiceNumber(tenantId);

      // tenantId starts with "ten" → "TEN"
      expect(result).toMatch(/^TEN-\d{4}-001$/);
    });

    it('increments sequence number correctly', async () => {
      mockPrisma.invoice.count.mockResolvedValue(42);

      const result = await service.generateInvoiceNumber(tenantId);

      expect(result).toMatch(/^TEN-\d{4}-043$/);
    });
  });

  // ─── Financial Year Helpers ──────────────────────────────────────

  describe('getFinancialYear', () => {
    it('returns current year for dates April-December', () => {
      expect(service.getFinancialYear(new Date(2024, 3, 1))).toBe(2024); // April 2024
      expect(service.getFinancialYear(new Date(2024, 11, 31))).toBe(2024); // December 2024
    });

    it('returns previous year for dates January-March', () => {
      expect(service.getFinancialYear(new Date(2025, 0, 15))).toBe(2024); // January 2025
      expect(service.getFinancialYear(new Date(2025, 2, 31))).toBe(2024); // March 2025
    });
  });

  // ─── Queries ─────────────────────────────────────────────────────

  describe('list', () => {
    it('returns invoices for current tenant', async () => {
      const invoices = [
        { id: 'inv-1', status: InvoiceStatus.ISSUED },
        { id: 'inv-2', status: InvoiceStatus.PAID },
      ];
      mockPrisma.invoice.findMany.mockResolvedValue(invoices);

      const result = await service.list();
      expect(result).toEqual(invoices);
      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId },
        }),
      );
    });

    it('filters by status when provided', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([]);

      await service.list(InvoiceStatus.PAID);

      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, status: InvoiceStatus.PAID },
        }),
      );
    });
  });

  describe('findById', () => {
    it('returns invoice with line items and payments', async () => {
      const invoice = {
        id: 'inv-1',
        lineItems: [{ id: 'li-1' }],
        payments: [{ id: 'pay-1' }],
      };
      mockPrisma.invoice.findUnique.mockResolvedValue(invoice);

      const result = await service.findById('inv-1');
      expect(result).toEqual(invoice);
    });

    it('throws when invoice not found', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('getReceipt', () => {
    it('returns receipt data with tenant details', async () => {
      const invoice = {
        id: 'inv-1',
        invoiceNumber: 'TEN-2024-001',
        issuedAt: new Date(),
        status: InvoiceStatus.PAID,
        customerName: 'John Doe',
        customerPhone: '9876543210',
        vehicleSummary: 'Toyota Camry 2022 - KA01AB1234',
        subtotalPaise: 180000,
        taxPaise: 32400,
        totalPaise: 212400,
        lineItems: [
          { id: 'li-1', description: 'Oil Change', quantity: 1, unitPaise: 50000, totalPaise: 50000, type: 'service' },
        ],
        payments: [
          { id: 'pay-1', amountPaise: 212400, method: 'CASH', paidAt: new Date() },
        ],
        tenant: {
          name: 'Test Garage',
          address: '123 Main St',
          gstin: 'GSTIN123',
          contactPhone: '9876543210',
        },
      };
      mockPrisma.invoice.findFirst.mockResolvedValue(invoice);

      const result = await service.getReceipt('inv-1');

      expect(result.invoice.invoiceNumber).toBe('TEN-2024-001');
      expect(result.invoice.paidPaise).toBe(212400);
      expect(result.invoice.remainingPaise).toBe(0);
      expect(result.tenant.name).toBe('Test Garage');
      expect(result.tenant.gstin).toBe('GSTIN123');
    });

    it('throws when invoice not found', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);

      await expect(service.getReceipt('nonexistent')).rejects.toThrow('not found');
    });
  });
});
