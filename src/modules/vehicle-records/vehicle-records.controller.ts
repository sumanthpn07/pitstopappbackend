import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators';
import type { AuthContext } from '../../common/auth.types';
import { VehicleRecordsService } from './vehicle-records.service';
import { OwnershipService } from './ownership.service';
import { ServiceHistoryService } from './service-history.service';
import { CreateVehicleRecordDto, UpdateVehicleRecordDto } from './dto';
import { InitiateTransferDto, RespondTransferDto } from './ownership.dto';
import { CreateOwnerServiceEventDto } from './service-history.dto';

@Controller('vehicles')
export class VehicleRecordsController {
  constructor(
    private readonly vehicleRecords: VehicleRecordsService,
    private readonly ownership: OwnershipService,
    private readonly serviceHistory: ServiceHistoryService,
  ) {}

  /** Register a new vehicle or link to an existing one via deduplication. */
  @Post('records')
  @HttpCode(HttpStatus.CREATED)
  register(@CurrentUser() auth: AuthContext, @Body() dto: CreateVehicleRecordDto) {
    return this.vehicleRecords.register(auth, dto);
  }

  /** List all vehicles owned by the current user. */
  @Get('records')
  findAll(@CurrentUser() auth: AuthContext) {
    return this.vehicleRecords.findAllForUser(auth.userId);
  }

  /** Get a vehicle record by ID. */
  @Get('records/:id')
  findById(@Param('id') id: string) {
    return this.vehicleRecords.findById(id);
  }

  /** Update a vehicle record (with audit trail). */
  @Patch('records/:id')
  update(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateVehicleRecordDto,
  ) {
    return this.vehicleRecords.update(auth, id, dto);
  }

  /** Initiate an ownership transfer (Req 2.1, 2.3, 2.5). */
  @Post('records/:id/ownership/transfer')
  @HttpCode(HttpStatus.CREATED)
  initiateTransfer(
    @CurrentUser() auth: AuthContext,
    @Param('id') vehicleId: string,
    @Body() dto: InitiateTransferDto,
  ) {
    return this.ownership.initiateTransfer(vehicleId, auth.userId, dto);
  }

  /** Confirm or decline a pending ownership transfer (Req 2.3, 2.7). */
  @Patch('records/:id/ownership/transfer/:transferId')
  respondToTransfer(
    @CurrentUser() auth: AuthContext,
    @Param('id') vehicleId: string,
    @Param('transferId') transferId: string,
    @Body() dto: RespondTransferDto,
  ) {
    if (dto.action === 'confirm') {
      return this.ownership.confirmTransfer(vehicleId, transferId, auth.userId);
    }
    return this.ownership.declineTransfer(vehicleId, transferId, auth.userId);
  }

  /** Get ownership timeline for a vehicle (Req 2.6). */
  @Get('records/:id/ownership')
  getOwnershipTimeline(@Param('id') vehicleId: string) {
    return this.ownership.getOwnershipTimeline(vehicleId);
  }

  /** Get paginated service history (Req 3.3, 5.6). */
  @Get('records/:id/history')
  getServiceHistory(
    @CurrentUser() auth: AuthContext,
    @Param('id') vehicleId: string,
    @Query('page') page?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    // Use full view — external filtering is handled per-event based on tenant membership
    return this.serviceHistory.getHistory(vehicleId, pageNum);
  }

  /** Add owner-reported service event (Req 3.6, 3.5). */
  @Post('records/:id/service-events')
  @HttpCode(HttpStatus.CREATED)
  addOwnerServiceEvent(
    @CurrentUser() auth: AuthContext,
    @Param('id') vehicleId: string,
    @Body() dto: CreateOwnerServiceEventDto,
  ) {
    return this.serviceHistory.addOwnerReported(auth, vehicleId, dto);
  }
}
