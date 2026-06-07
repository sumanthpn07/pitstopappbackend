import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators';
import { CatalogService } from './catalog.service';

@Controller('offers')
export class OffersController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get()
  getOffers() {
    return this.catalog.getOffers();
  }
}
