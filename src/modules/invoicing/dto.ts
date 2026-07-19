import { PaymentMethod } from '@prisma/client';

// ─── Generate Invoice ──────────────────────────────────────────

export interface GenerateInvoiceDto {
  jobCardId: string;
}

// ─── Record Payment ────────────────────────────────────────────

export interface RecordPaymentDto {
  amountPaise: number; // must be > 0
  method: PaymentMethod;
  reference?: string;
}
