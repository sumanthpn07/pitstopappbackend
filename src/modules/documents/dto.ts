import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DocumentType } from '@prisma/client';

// ─── Vehicle Document DTOs ─────────────────────────────────────

/** Allowed MIME types for vehicle documents. */
export const ALLOWED_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

/** Max file size for vehicle documents: 10 MB. */
export const MAX_DOCUMENT_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Allowed MIME types for job card photos. */
export const ALLOWED_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png'];

/** Max file size for job card photos: 5 MB. */
export const MAX_PHOTO_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/** Max photos per job card. */
export const MAX_PHOTOS_PER_JOB_CARD = 20;

export class CreateVehicleDocumentDto {
  @IsEnum(DocumentType)
  documentType!: DocumentType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  issuer?: string;

  @IsDateString()
  issueDate!: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsString()
  @IsUrl()
  fileUrl!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_DOCUMENT_FILE_SIZE_BYTES)
  fileSizeBytes!: number;

  @IsString()
  mimeType!: string;
}

// ─── Job Card Photo DTOs ───────────────────────────────────────

export type PhotoKind = 'before' | 'after';

export class CreateJobCardPhotoDto {
  @IsString()
  @IsUrl()
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;

  @IsString()
  kind!: string; // 'before' | 'after'

  @IsInt()
  @Min(1)
  @Max(MAX_PHOTO_FILE_SIZE_BYTES)
  fileSizeBytes!: number;

  @IsString()
  mimeType!: string;
}
