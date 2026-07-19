import { Injectable, Logger } from '@nestjs/common';
import { InvoiceStatus, JobCardStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../common/providers/tenant-context.provider';
import { EventsService } from '../events/events.service';
import { EventTypes } from '../events/event-types';
import { ApiException } from '../../common/api-exception';
import type { GenerateInvoiceDto, RecordPaymentDto } from './dto';

/** Maximum number of payment methods per invoice. */
const MAX_PAYMENTS_PER_INVOICE = 4;

@Injectable()
export class InvoicingService {
  private readonly logger = new Logger(InvoicingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly eventsService: EventsService,
  ) {}

  // ─── Invoice Generation ──────────────────────────────────────────

  /**
   * Generate an invoice from a completed JobCard.
   * This also transitions the JobCard to INVOICED and publishes events.
   */
  async generate(dto: GenerateInvoiceDto) {
    const tenantId = this.requireTenant();

    // Fetch the job card with items and parts
    const jobCard = await this.prisma.jobCard.findFirst({
      where: { id: dto.jobCardId, tenantId },
      include: {
        items: { include: { service: true } },
        partsConsumed: { where: { reversed: false }, include: { inventoryItem: true } },
        vehicleRecord: true,
      },
    });

    if (!jobCard) {
      throw ApiException.notFound('Job card not found.');
    }

    // Validate job card is in COMPLETED status
    if (jobCard.status !== JobCardStatus.COMPLETED) {
      throw ApiException.invalidTransition(
        `Cannot generate invoice: job card is in ${jobCard.status} status. Must be COMPLETED.`,
      );
    }

    // Check if invoice already exists for this job card
    const existingInvoice = await this.prisma.invoice.findUnique({
      where: { jobCardId: dto.jobCardId },
    });
    if (existingInvoice) {
      throw ApiException.validation('Invoice already exists for this job card.');
    }

    // Validate data completeness (Req 8.7)
    const validationErrors: string[] = [];

    if (jobCard.items.length === 0 && jobCard.partsConsumed.length === 0) {
      validationErrors.push('No line items (services or parts consumed).');
    }

    // Get tenant configuration for GST rate
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw ApiException.notFound('Tenant not found.');
    }

    if (tenant.gstRate === null || tenant.gstRate === undefined) {
      validationErrors.push('Tax rate (GST) not configured for tenant.');
    }

    // Fetch customer details
    const customer = await this.prisma.user.findUnique({
      where: { id: jobCard.customerId },
    });
    if (!customer) {
      validationErrors.push('Customer not found.');
    }

    if (validationErrors.length > 0) {
      throw ApiException.validation(
        `Cannot generate invoice: ${validationErrors.join(' ')}`,
      );
    }

    // Build line items
    const serviceLineItems = jobCard.items.map((item) => ({
      description: item.service.name,
      quantity: 1,
      unitPaise: item.pricePaise,
      totalPaise: item.pricePaise,
      type: 'service' as const,
    }));

    const partLineItems = jobCard.partsConsumed.map((part) => ({
      description: part.inventoryItem.name,
      quantity: part.quantity,
      unitPaise: part.unitCostPaise,
      totalPaise: part.quantity * part.unitCostPaise,
      type: 'part' as const,
    }));

    const allLineItems = [...serviceLineItems, ...partLineItems];

    // Calculate totals
    const subtotalPaise = allLineItems.reduce((sum, item) => sum + item.totalPaise, 0);
    const taxPaise = Math.round(subtotalPaise * (tenant!.gstRate / 100));
    const totalPaise = subtotalPaise + taxPaise;

    // Generate sequential invoice number
    const invoiceNumber = await this.generateInvoiceNumber(tenantId);

    // Build vehicle summary
    const vr = jobCard.vehicleRecord;
    const vehicleSummary = `${vr.make} ${vr.model} ${vr.year}${vr.registrationPlate ? ' - ' + vr.registrationPlate : ''}`;

    // Create invoice and transition job card in a transaction
    const invoice = await this.prisma.$transaction(async (tx) => {
      // Create invoice
      const inv = await tx.invoice.create({
        data: {
          tenantId,
          jobCardId: dto.jobCardId,
          invoiceNumber,
          customerId: jobCard.customerId,
          customerName: customer!.name || 'Unknown',
          customerPhone: customer!.phone || null,
          vehicleSummary,
          subtotalPaise,
          taxPaise,
          totalPaise,
          status: InvoiceStatus.ISSUED,
        },
      });

      // Create line items
      await tx.invoiceLineItem.createMany({
        data: allLineItems.map((item) => ({
          invoiceId: inv.id,
          description: item.description,
          quantity: item.quantity,
          unitPaise: item.unitPaise,
          totalPaise: item.totalPaise,
          type: item.type,
        })),
      });

      // Transition job card to INVOICED
      await tx.jobCard.update({
        where: { id: dto.jobCardId },
        data: { status: JobCardStatus.INVOICED },
      });

      // Create FinanceTxn income record
      await tx.tenantFinanceTxn.create({
        data: {
          tenantId,
          type: 'income',
          category: 'service',
          note: `Invoice ${invoiceNumber} generated`,
          amountPaise: totalPaise,
          invoiceId: inv.id,
          jobCardId: dto.jobCardId,
          date: new Date(),
        },
      });

      return inv;
    });

    // Publish invoice.generated event
    await this.eventsService.publish({
      eventType: EventTypes.INVOICE_GENERATED,
      sourceEntity: 'Invoice',
      sourceId: invoice.id,
      payload: {
        invoiceId: invoice.id,
        tenantId,
        jobCardId: dto.jobCardId,
        customerId: jobCard.customerId,
        totalPaise,
      },
    });

    this.logger.log(`Invoice ${invoiceNumber} generated for job card ${dto.jobCardId}`);

    return this.findById(invoice.id);
  }

  // ─── Payment Recording ───────────────────────────────────────────

  /**
   * Record a payment against an invoice.
   * Supports split payments (up to 4 methods).
   */
  async recordPayment(invoiceId: string, dto: RecordPaymentDto) {
    const tenantId = this.requireTenant();

    // Validate amount
    if (!dto.amountPaise || dto.amountPaise <= 0) {
      throw ApiException.validation('Payment amount must be greater than 0.');
    }

    // Fetch invoice with existing payments
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { payments: true },
    });

    if (!invoice) {
      throw ApiException.notFound('Invoice not found.');
    }

    // Cannot pay a cancelled invoice
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw ApiException.invalidTransition('Cannot record payment on a cancelled invoice.');
    }

    // Cannot pay an already fully paid invoice
    if (invoice.status === InvoiceStatus.PAID) {
      throw ApiException.invalidTransition('Invoice is already fully paid.');
    }

    // Check max payments limit
    if (invoice.payments.length >= MAX_PAYMENTS_PER_INVOICE) {
      throw ApiException.validation(
        `Maximum ${MAX_PAYMENTS_PER_INVOICE} payments allowed per invoice.`,
      );
    }

    // Calculate paid so far
    const paidSoFar = invoice.payments.reduce((sum, p) => sum + p.amountPaise, 0);
    const remainingBalance = invoice.totalPaise - paidSoFar;

    // Validate payment doesn't exceed remaining balance
    if (dto.amountPaise > remainingBalance) {
      throw ApiException.validation(
        `Payment amount (${dto.amountPaise}) exceeds remaining balance (${remainingBalance}).`,
      );
    }

    // Record payment and update status
    const newPaidTotal = paidSoFar + dto.amountPaise;
    const newStatus = newPaidTotal >= invoice.totalPaise
      ? InvoiceStatus.PAID
      : InvoiceStatus.PARTIALLY_PAID;

    const [payment] = await this.prisma.$transaction([
      this.prisma.invoicePayment.create({
        data: {
          invoiceId,
          amountPaise: dto.amountPaise,
          method: dto.method,
          reference: dto.reference || null,
        },
      }),
      this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: newStatus },
      }),
    ]);

    // On full payment, publish event and send notification
    if (newStatus === InvoiceStatus.PAID) {
      await this.eventsService.publish({
        eventType: EventTypes.INVOICE_PAID,
        sourceEntity: 'Invoice',
        sourceId: invoiceId,
        payload: {
          invoiceId,
          tenantId,
          customerId: invoice.customerId,
          totalPaise: invoice.totalPaise,
        },
      });

      this.logger.log(`Invoice ${invoice.invoiceNumber} fully paid`);
    }

    return {
      payment,
      invoiceStatus: newStatus,
      totalPaise: invoice.totalPaise,
      paidPaise: newPaidTotal,
      remainingPaise: invoice.totalPaise - newPaidTotal,
    };
  }

  // ─── Queries ─────────────────────────────────────────────────────

  /**
   * List invoices for the current tenant.
   */
  async list(status?: InvoiceStatus) {
    const tenantId = this.requireTenant();

    return this.prisma.invoice.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
      },
      include: {
        payments: true,
      },
      orderBy: { issuedAt: 'desc' },
    });
  }

  /**
   * Get a single invoice with line items and payments.
   */
  async findById(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        lineItems: true,
        payments: true,
      },
    });

    if (!invoice) {
      throw ApiException.notFound('Invoice not found.');
    }

    return invoice;
  }

  /**
   * Get invoice receipt data (for rendering).
   */
  async getReceipt(id: string) {
    const tenantId = this.requireTenant();

    const invoice = await this.prisma.invoice.findFirst({
      where: { id, tenantId },
      include: {
        lineItems: true,
        payments: true,
        tenant: {
          select: {
            name: true,
            address: true,
            gstin: true,
            contactPhone: true,
          },
        },
      },
    });

    if (!invoice) {
      throw ApiException.notFound('Invoice not found.');
    }

    const paidPaise = invoice.payments.reduce((sum, p) => sum + p.amountPaise, 0);

    return {
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        issuedAt: invoice.issuedAt,
        status: invoice.status,
        customerName: invoice.customerName,
        customerPhone: invoice.customerPhone,
        vehicleSummary: invoice.vehicleSummary,
        subtotalPaise: invoice.subtotalPaise,
        taxPaise: invoice.taxPaise,
        totalPaise: invoice.totalPaise,
        paidPaise,
        remainingPaise: invoice.totalPaise - paidPaise,
      },
      lineItems: invoice.lineItems,
      payments: invoice.payments,
      tenant: invoice.tenant,
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  /**
   * Generate sequential invoice number per tenant per financial year.
   * Format: {tenantId-short}-{FY}-{seq} e.g. ABC-2024-001
   * Financial year starts April 1.
   */
  async generateInvoiceNumber(tenantId: string): Promise<string> {
    const now = new Date();
    const financialYear = this.getFinancialYear(now);
    const prefix = tenantId.substring(0, 3).toUpperCase();

    // Count existing invoices for this tenant in this financial year
    const fyStart = this.getFinancialYearStart(financialYear);
    const fyEnd = this.getFinancialYearEnd(financialYear);

    const count = await this.prisma.invoice.count({
      where: {
        tenantId,
        issuedAt: {
          gte: fyStart,
          lt: fyEnd,
        },
      },
    });

    const seq = (count + 1).toString().padStart(3, '0');
    return `${prefix}-${financialYear}-${seq}`;
  }

  /**
   * Get the financial year for a given date.
   * Financial year starts April 1 - returns the starting year.
   * e.g. for March 2025 → 2024, for April 2025 → 2025
   */
  getFinancialYear(date: Date): number {
    const month = date.getMonth(); // 0-indexed (0 = Jan, 3 = April)
    const year = date.getFullYear();
    return month >= 3 ? year : year - 1;
  }

  /**
   * Get the start date of a financial year (April 1).
   */
  getFinancialYearStart(fy: number): Date {
    return new Date(fy, 3, 1); // April 1 of the FY start year
  }

  /**
   * Get the end date of a financial year (March 31 of next year + 1 day for < comparison).
   */
  getFinancialYearEnd(fy: number): Date {
    return new Date(fy + 1, 3, 1); // April 1 of next year (exclusive)
  }

  private requireTenant(): string {
    const tenantId = this.tenantContext.tenantId;
    if (!tenantId) {
      throw ApiException.validation('Tenant context is required.');
    }
    return tenantId;
  }
}
