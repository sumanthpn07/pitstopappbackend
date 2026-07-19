import { Controller, Get, Param } from '@nestjs/common';
import { HealthScoreService } from './health-score.service';
import { ApiException } from '../../common/api-exception';

@Controller('vehicles')
export class HealthScoreController {
  constructor(private readonly healthScoreService: HealthScoreService) {}

  /**
   * GET /vehicles/records/:id/health-score
   * Returns the current health score with breakdown for a vehicle.
   */
  @Get('records/:id/health-score')
  async getHealthScore(@Param('id') vehicleRecordId: string) {
    const result = await this.healthScoreService.getHealthScore(vehicleRecordId);

    if (!result) {
      throw ApiException.notFound(
        'Health score has not been calculated yet for this vehicle.',
      );
    }

    return result;
  }
}
