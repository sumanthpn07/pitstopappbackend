import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { InvoicingService } from './invoicing.service';
import type { GenerateInvoiceDto, RecordPaymentDto } from './dto';

@Controller('invoices')
export class InvoicingController {
  constructor(private readonly invoicingService: InvoicingService) {}

  /** Generate an invoice from a completed job card. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  generate(@Body() dto: GenerateInvoiceDto) {
    return this.invoicingService.generate(dto);
  }

  /** List invoices for the current tenant. */
  @Get()
  list(@Query('status') status?: InvoiceStatus) {
    return this.invoicingService.list(status);
  }

  /** Get invoice detail with line items and payments. */
  @Get(':id')
  findById(@Param('id') id: string) {
    return this.invoicingService.findById(id);
  }

  /** Get invoice receipt data. */
  @Get(':id/receipt')
  getReceipt(@Param('id') id: string) {
    return this.invoicingService.getReceipt(id);
  }

  /** Record a payment against an invoice. */
  @Post(':id/payments')
  @HttpCode(HttpStatus.OK)
  recordPayment(@Param('id') id: string, @Body() dto: RecordPaymentDto) {
    return this.invoicingService.recordPayment(id, dto);
  }
}
