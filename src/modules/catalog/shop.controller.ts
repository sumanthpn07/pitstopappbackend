import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators';
import { CatalogService } from './catalog.service';

@Controller('shop')
export class ShopController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get()
  getShop() {
    return this.catalog.getShop();
  }
}
