import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { ShopController } from './shop.controller';
import { ServicesController } from './services.controller';
import { AvailabilityController } from './availability.controller';

@Module({
  controllers: [ShopController, ServicesController, AvailabilityController],
  providers: [CatalogService],
})
export class CatalogModule {}
