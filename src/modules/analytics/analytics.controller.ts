import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators';
import type { AuthContext } from '../../common/auth.types';
import { AnalyticsService } from './analytics.service';
import type { RevenueQuery, ServicesQuery, FleetAnalyticsQuery } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * GET /analytics/revenue?period=daily|weekly|monthly&from=&to=
   * Revenue breakdown for the tenant.
   */
  @Get('revenue')
  getRevenue(
    @Query('period') period?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const validPeriod = (['daily', 'weekly', 'monthly'] as const).includes(
      period as any,
    )
      ? (period as RevenueQuery['period'])
      : 'monthly';

    return this.analyticsService.getRevenue({ period: validPeriod, from, to });
  }

  /**
   * GET /analytics/services?from=&to=
   * Top 10 services and category breakdown.
   */
  @Get('services')
  getServices(@Query('from') from?: string, @Query('to') to?: string) {
    const query: ServicesQuery = { from, to };
    return this.analyticsService.getServices(query);
  }

  /**
   * GET /analytics/customers
   * Customer retention rate and at-risk list.
   */
  @Get('customers')
  getCustomers() {
    return this.analyticsService.getCustomers();
  }

  /**
   * GET /analytics/fleet/:fleetId?from=&to=
   * Fleet cost analytics.
   */
  @Get('fleet/:fleetId')
  getFleetAnalytics(
    @Param('fleetId') fleetId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const query: FleetAnalyticsQuery = { from, to };
    return this.analyticsService.getFleetAnalytics(fleetId, query);
  }

  /**
   * GET /analytics/inventory-turnover?from=&to=
   * Inventory turnover rate for the tenant.
   */
  @Get('inventory-turnover')
  getInventoryTurnover(@Query('from') from?: string, @Query('to') to?: string) {
    return this.analyticsService.getInventoryTurnover(from, to);
  }
}
