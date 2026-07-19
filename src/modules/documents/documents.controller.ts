import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { CreateVehicleDocumentDto, CreateJobCardPhotoDto } from './dto';

@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  // ─── Vehicle Documents ───────────────────────────────────────────

  /** Upload a document for a vehicle record (Req 15.1, 15.2). */
  @Post('vehicles/records/:id/documents')
  @HttpCode(HttpStatus.CREATED)
  createDocument(
    @Param('id') vehicleRecordId: string,
    @Body() dto: CreateVehicleDocumentDto,
  ) {
    return this.documents.createDocument(vehicleRecordId, dto);
  }

  /** List all documents for a vehicle record (Req 15.7). */
  @Get('vehicles/records/:id/documents')
  listDocuments(@Param('id') vehicleRecordId: string) {
    return this.documents.listDocuments(vehicleRecordId);
  }

  // ─── Job Card Photos ─────────────────────────────────────────────

  /** Upload a photo to a job card (Req 15.5). */
  @Post('job-cards/:id/photos')
  @HttpCode(HttpStatus.CREATED)
  createPhoto(
    @Param('id') jobCardId: string,
    @Body() dto: CreateJobCardPhotoDto,
  ) {
    return this.documents.createPhoto(jobCardId, dto);
  }

  /** List photos for a job card. */
  @Get('job-cards/:id/photos')
  listPhotos(@Param('id') jobCardId: string) {
    return this.documents.listPhotos(jobCardId);
  }
}
