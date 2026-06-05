import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators';
import { CatalogService } from './catalog.service';

@Controller('services')
export class ServicesController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get()
  getServices() {
    return this.catalog.getActiveServices();
  }
}
