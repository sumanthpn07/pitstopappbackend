import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { ShopController } from './shop.controller';
import { ServicesController } from './services.controller';
import { AvailabilityController } from './availability.controller';
import { OffersController } from './offers.controller';

@Module({
  controllers: [ShopController, ServicesController, AvailabilityController, OffersController],
  providers: [CatalogService],
})
export class CatalogModule {}
