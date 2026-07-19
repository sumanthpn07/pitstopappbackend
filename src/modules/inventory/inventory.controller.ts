import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators';
import type { AuthContext } from '../../common/auth.types';
import { InventoryService } from './inventory.service';
import type {
  CreateInventoryItemDto,
  UpdateInventoryItemDto,
  PurchaseDto,
  ConsumeDto,
  ReturnDto,
  AdjustDto,
} from './dto';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  /** List all inventory items for the current tenant. */
  @Get()
  list() {
    return this.inventoryService.list();
  }

  /** Stock valuation report by category. */
  @Get('report/valuation')
  getValuationReport() {
    return this.inventoryService.getValuationReport();
  }

  /** Movement audit trail. */
  @Get('movements')
  getMovements(
    @Query('itemId') itemId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.inventoryService.getMovements(
      itemId,
      limit ? parseInt(limit, 10) : undefined,
      offset ? parseInt(offset, 10) : undefined,
    );
  }

  /** Create a new inventory item. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateInventoryItemDto) {
    return this.inventoryService.create(dto);
  }

  /** Update an inventory item. */
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateInventoryItemDto) {
    return this.inventoryService.update(id, dto);
  }

  /** Record a purchase (increase qty + recalculate weighted average cost). */
  @Post(':id/purchase')
  @HttpCode(HttpStatus.OK)
  purchase(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: PurchaseDto,
  ) {
    return this.inventoryService.purchase(id, dto, auth.userId);
  }

  /** Manual consumption (decrease qty, reject if below 0). */
  @Post(':id/consume')
  @HttpCode(HttpStatus.OK)
  consume(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: ConsumeDto,
  ) {
    return this.inventoryService.consume(id, dto, auth.userId);
  }

  /** Return (increase qty). */
  @Post(':id/return')
  @HttpCode(HttpStatus.OK)
  returnItem(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: ReturnDto,
  ) {
    return this.inventoryService.return(id, dto, auth.userId);
  }

  /** Adjustment (set qty directly). */
  @Post(':id/adjust')
  @HttpCode(HttpStatus.OK)
  adjust(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: AdjustDto,
  ) {
    return this.inventoryService.adjust(id, dto, auth.userId);
  }
}
