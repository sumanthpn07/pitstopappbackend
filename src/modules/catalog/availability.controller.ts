import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../../common/decorators';
import { CatalogService } from './catalog.service';

@Controller('availability')
export class AvailabilityController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get()
  getAvailability(@Query('serviceId') serviceId: string, @Query('date') date: string) {
    return this.catalog.getAvailability(serviceId, date);
  }
}
