import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../common/providers/tenant-context.provider';
import { ApiException } from '../../common/api-exception';

/** Valid job card statuses for analytics computations (Req 14.5) */
const ANALYTICS_STATUSES = ['COMPLETED', 'INVOICED'] as const;

export interface RevenueQuery {
  period: 'daily' | 'weekly' | 'monthly';
  from?: string; // ISO date
  to?: string; // ISO date
}

export interface ServicesQuery {
  from?: string;
  to?: string;
}

export interface FleetAnalyticsQuery {
  from?: string;
  to?: string;
}

export interface RevenueBreakdown {
  periodLabel: string;
  totalPaise: number;
}

export interface RevenueByCategoryItem {
  category: string;
  totalPaise: number;
}

export interface TopServiceItem {
  serviceType: string;
  frequency: number;
}

export interface CategoryBreakdownItem {
  category: string;
  count: number;
  totalPaise: number;
}

export interface AtRiskCustomer {
  customerId: string;
  customerName: string;
  daysSinceLastVisit: number;
}

export interface CustomerAnalytics {
  retentionRate: number;
  totalUniqueCustomers: number;
  returningCustomers: number;
  atRiskCustomers: AtRiskCustomer[];
}

export interface FleetCostAnalytics {
  costPerVehiclePerMonth: Array<{ vehicleRecordId: string; month: string; totalPaise: number }>;
  maintenanceCompliancePercent: number;
  avgDowntimeHours: number;
  totalSpendPaise: number;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  // ─── Revenue Analytics ───────────────────────────────────────────

  /**
   * Revenue breakdown by period (daily/weekly/monthly) and by category.
   * Req 14.1: daily/weekly/monthly revenue, revenue by category, avg job card value
   * Req 14.5: Only COMPLETED/INVOICED job cards
   * Req 14.7: Empty period returns zeros with message
   */
  async getRevenue(query: RevenueQuery) {
    const tenantId = this.requireTenant();
    const { from, to } = this.resolveDefaultDateRange(query.from, query.to);

    // Get completed/invoiced job cards in the date range
    const jobCards = await this.prisma.jobCard.findMany({
      where: {
        tenantId,
        status: { in: [...ANALYTICS_STATUSES] },
        updatedAt: { gte: from, lte: to },
      },
      include: {
        invoice: true,
        items: true,
      },
    });

    if (jobCards.length === 0) {
      return {
        breakdown: [],
        revenueByCategory: [],
        avgJobCardValuePaise: 0,
        totalRevenuePaise: 0,
        message: 'No data is available for the selected period.',
      };
    }

    // Compute total revenue from invoices
    const invoicedCards = jobCards.filter((jc) => jc.invoice);
    const totalRevenuePaise = invoicedCards.reduce(
      (sum, jc) => sum + (jc.invoice?.totalPaise ?? 0),
      0,
    );

    // Average job card value
    const avgJobCardValuePaise =
      invoicedCards.length > 0 ? Math.round(totalRevenuePaise / invoicedCards.length) : 0;

    // Revenue breakdown by period
    const breakdown = this.computeRevenueBreakdown(invoicedCards, query.period);

    // Revenue by category (from job card items linked to services)
    const revenueByCategory = await this.computeRevenueByCategory(tenantId, from, to);

    return {
      breakdown,
      revenueByCategory,
      avgJobCardValuePaise,
      totalRevenuePaise,
      message: null,
    };
  }

  // ─── Services Analytics ──────────────────────────────────────────

  /**
   * Top 10 services by frequency, category breakdown.
   * Req 14.1: top 10 services by frequency
   * Req 14.5: Only COMPLETED/INVOICED job cards
   * Req 14.7: Empty period returns zeros with message
   */
  async getServices(query: ServicesQuery) {
    const tenantId = this.requireTenant();
    const { from, to } = this.resolveDefaultDateRange(query.from, query.to);

    // Get all job card items from completed/invoiced job cards in the period
    const jobCardItems = await this.prisma.jobCardItem.findMany({
      where: {
        jobCard: {
          tenantId,
          status: { in: [...ANALYTICS_STATUSES] },
          updatedAt: { gte: from, lte: to },
        },
      },
      include: {
        service: { select: { name: true, category: true } },
      },
    });

    if (jobCardItems.length === 0) {
      return {
        topServices: [],
        categoryBreakdown: [],
        message: 'No data is available for the selected period.',
      };
    }

    // Top 10 services by frequency
    const serviceFrequency = new Map<string, number>();
    for (const item of jobCardItems) {
      const serviceName = item.service.name;
      serviceFrequency.set(serviceName, (serviceFrequency.get(serviceName) ?? 0) + 1);
    }

    const topServices: TopServiceItem[] = Array.from(serviceFrequency.entries())
      .map(([serviceType, frequency]) => ({ serviceType, frequency }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);

    // Category breakdown
    const categoryMap = new Map<string, { count: number; totalPaise: number }>();
    for (const item of jobCardItems) {
      const category = item.service.category || 'uncategorized';
      const existing = categoryMap.get(category) ?? { count: 0, totalPaise: 0 };
      existing.count += 1;
      existing.totalPaise += item.pricePaise;
      categoryMap.set(category, existing);
    }

    const categoryBreakdown: CategoryBreakdownItem[] = Array.from(categoryMap.entries())
      .map(([category, data]) => ({ category, count: data.count, totalPaise: data.totalPaise }))
      .sort((a, b) => b.count - a.count);

    return {
      topServices,
      categoryBreakdown,
      message: null,
    };
  }

  // ─── Customer Analytics ──────────────────────────────────────────

  /**
   * Customer retention rate and at-risk list.
   * Req 14.2: retention = (customers with >1 visit in 90d) / (total unique customers in 90d)
   * Req 14.3: At-risk = no visit in 60+ days, show name + days since last
   * Req 14.5: Only COMPLETED/INVOICED job cards
   * Req 14.7: Empty period returns zeros with message
   */
  async getCustomers(): Promise<CustomerAnalytics & { message: string | null }> {
    const tenantId = this.requireTenant();
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    // Get all completed/invoiced job cards in last 90 days
    const recentJobCards = await this.prisma.jobCard.findMany({
      where: {
        tenantId,
        status: { in: [...ANALYTICS_STATUSES] },
        updatedAt: { gte: ninetyDaysAgo },
      },
      select: {
        customerId: true,
        updatedAt: true,
      },
    });

    if (recentJobCards.length === 0) {
      return {
        retentionRate: 0,
        totalUniqueCustomers: 0,
        returningCustomers: 0,
        atRiskCustomers: [],
        message: 'No data is available for the selected period.',
      };
    }

    // Count visits per customer in last 90 days
    const customerVisits = new Map<string, number>();
    for (const jc of recentJobCards) {
      customerVisits.set(jc.customerId, (customerVisits.get(jc.customerId) ?? 0) + 1);
    }

    const totalUniqueCustomers = customerVisits.size;
    const returningCustomers = Array.from(customerVisits.values()).filter((v) => v > 1).length;

    // Retention rate: (customers with >1 visit in 90 days) / (total unique customers in 90 days)
    const retentionRate =
      totalUniqueCustomers > 0 ? returningCustomers / totalUniqueCustomers : 0;

    // At-risk customers: last visit > 60 days ago
    // Get ALL customers who have visited this tenant (not just last 90 days)
    const allCustomerJobCards = await this.prisma.jobCard.findMany({
      where: {
        tenantId,
        status: { in: [...ANALYTICS_STATUSES] },
      },
      select: {
        customerId: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Find last visit per customer
    const lastVisitMap = new Map<string, Date>();
    for (const jc of allCustomerJobCards) {
      if (!lastVisitMap.has(jc.customerId)) {
        lastVisitMap.set(jc.customerId, jc.updatedAt);
      }
    }

    // Find at-risk: no visit in 60+ days
    const atRiskCustomerIds: Array<{ customerId: string; lastVisit: Date }> = [];
    for (const [customerId, lastVisit] of lastVisitMap) {
      if (lastVisit < sixtyDaysAgo) {
        atRiskCustomerIds.push({ customerId, lastVisit });
      }
    }

    // Fetch customer names
    let atRiskCustomers: AtRiskCustomer[] = [];
    if (atRiskCustomerIds.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: atRiskCustomerIds.map((c) => c.customerId) } },
        select: { id: true, name: true },
      });

      const userNameMap = new Map(users.map((u) => [u.id, u.name ?? 'Unknown']));

      atRiskCustomers = atRiskCustomerIds.map(({ customerId, lastVisit }) => ({
        customerId,
        customerName: userNameMap.get(customerId) ?? 'Unknown',
        daysSinceLastVisit: Math.floor(
          (now.getTime() - lastVisit.getTime()) / (24 * 60 * 60 * 1000),
        ),
      }));

      // Sort by days since last visit descending
      atRiskCustomers.sort((a, b) => b.daysSinceLastVisit - a.daysSinceLastVisit);
    }

    return {
      retentionRate,
      totalUniqueCustomers,
      returningCustomers,
      atRiskCustomers,
      message: null,
    };
  }

  // ─── Fleet Analytics ─────────────────────────────────────────────

  /**
   * Fleet cost analytics.
   * Req 14.4: cost per vehicle per month, maintenance compliance %, avg downtime, total spend
   * Req 14.5: Only COMPLETED/INVOICED job cards
   * Req 14.7: Empty period returns zeros with message
   */
  async getFleetAnalytics(fleetId: string, query: FleetAnalyticsQuery): Promise<FleetCostAnalytics & { message: string | null }> {
    const { from, to } = this.resolveDefaultDateRange(query.from, query.to);

    // Get fleet vehicles
    const fleet = await this.prisma.fleet.findUnique({
      where: { id: fleetId },
      include: {
        vehicles: {
          where: { removedAt: null },
          select: { vehicleRecordId: true },
        },
      },
    });

    if (!fleet) {
      throw ApiException.notFound('Fleet not found.');
    }

    const vehicleRecordIds = fleet.vehicles.map((v) => v.vehicleRecordId);

    if (vehicleRecordIds.length === 0) {
      return {
        costPerVehiclePerMonth: [],
        maintenanceCompliancePercent: 0,
        avgDowntimeHours: 0,
        totalSpendPaise: 0,
        message: 'No data is available for the selected period.',
      };
    }

    // Get service events for fleet vehicles (from completed/invoiced job cards)
    const serviceEvents = await this.prisma.serviceEvent.findMany({
      where: {
        vehicleRecordId: { in: vehicleRecordIds },
        completedAt: { gte: from, lte: to },
        source: { in: ['JOB_CARD'] },
      },
      select: {
        vehicleRecordId: true,
        totalCostPaise: true,
        completedAt: true,
      },
    });

    // Also check that the underlying job cards are in the right status
    const jobCards = await this.prisma.jobCard.findMany({
      where: {
        vehicleRecordId: { in: vehicleRecordIds },
        status: { in: [...ANALYTICS_STATUSES] },
        updatedAt: { gte: from, lte: to },
      },
      select: {
        vehicleRecordId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (serviceEvents.length === 0 && jobCards.length === 0) {
      return {
        costPerVehiclePerMonth: [],
        maintenanceCompliancePercent: 0,
        avgDowntimeHours: 0,
        totalSpendPaise: 0,
        message: 'No data is available for the selected period.',
      };
    }

    // Cost per vehicle per month
    const vehicleMonthCost = new Map<string, number>();
    for (const se of serviceEvents) {
      const monthKey = `${se.vehicleRecordId}|${se.completedAt.getFullYear()}-${String(se.completedAt.getMonth() + 1).padStart(2, '0')}`;
      vehicleMonthCost.set(monthKey, (vehicleMonthCost.get(monthKey) ?? 0) + se.totalCostPaise);
    }

    const costPerVehiclePerMonth = Array.from(vehicleMonthCost.entries()).map(([key, totalPaise]) => {
      const [vehicleRecordId, month] = key.split('|');
      return { vehicleRecordId, month, totalPaise };
    });

    // Total spend
    const totalSpendPaise = serviceEvents.reduce((sum, se) => sum + se.totalCostPaise, 0);

    // Maintenance compliance: (vehicles serviced on or before scheduled date) / (vehicles with scheduled service)
    const scheduledItems = await this.prisma.maintenanceScheduleEntry.findMany({
      where: {
        vehicleRecordId: { in: vehicleRecordIds },
        dueDate: { gte: from, lte: to },
      },
      select: {
        vehicleRecordId: true,
        dueDate: true,
        completed: true,
        completedAt: true,
      },
    });

    let compliantCount = 0;
    let totalScheduled = scheduledItems.length;
    for (const item of scheduledItems) {
      if (item.completed && item.completedAt && item.dueDate && item.completedAt <= item.dueDate) {
        compliantCount++;
      }
    }

    const maintenanceCompliancePercent =
      totalScheduled > 0 ? Math.round((compliantCount / totalScheduled) * 100) : 0;

    // Avg downtime: total hours vehicles had active job cards / number of vehicles
    let totalDowntimeMs = 0;
    for (const jc of jobCards) {
      const start = jc.createdAt.getTime();
      const end = jc.updatedAt.getTime();
      totalDowntimeMs += end - start;
    }
    const avgDowntimeHours =
      vehicleRecordIds.length > 0
        ? Math.round((totalDowntimeMs / vehicleRecordIds.length / (1000 * 60 * 60)) * 100) / 100
        : 0;

    return {
      costPerVehiclePerMonth,
      maintenanceCompliancePercent,
      avgDowntimeHours,
      totalSpendPaise,
      message: null,
    };
  }

  // ─── Inventory Turnover ──────────────────────────────────────────

  /**
   * Compute inventory turnover rate.
   * Req 14.6: (total cost of parts consumed in period) / (avg inventory value)
   */
  async getInventoryTurnover(from?: string, to?: string) {
    const tenantId = this.requireTenant();
    const { from: dateFrom, to: dateTo } = this.resolveDefaultDateRange(from, to);

    // Total cost of parts consumed in period
    const consumptions = await this.prisma.inventoryMovement.findMany({
      where: {
        inventoryItem: { tenantId },
        type: 'CONSUMPTION',
        createdAt: { gte: dateFrom, lte: dateTo },
      },
      include: {
        inventoryItem: { select: { unitCostPaise: true } },
      },
    });

    const totalCostOfPartsConsumed = consumptions.reduce(
      (sum, m) => sum + Math.abs(m.quantityDelta) * m.inventoryItem.unitCostPaise,
      0,
    );

    // Average inventory value: current total inventory value
    // (simplified: using current quantities * unit costs as an approximation)
    const inventoryItems = await this.prisma.inventoryItem.findMany({
      where: { tenantId },
      select: { quantity: true, unitCostPaise: true },
    });

    const currentInventoryValue = inventoryItems.reduce(
      (sum, item) => sum + item.quantity * item.unitCostPaise,
      0,
    );

    // Inventory turnover = total cost of parts consumed / avg inventory value
    const inventoryTurnoverRate =
      currentInventoryValue > 0
        ? Math.round((totalCostOfPartsConsumed / currentInventoryValue) * 100) / 100
        : 0;

    return {
      totalCostOfPartsConsumedPaise: totalCostOfPartsConsumed,
      avgInventoryValuePaise: currentInventoryValue,
      inventoryTurnoverRate,
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  /**
   * Compute retention rate from a list of customer visit counts.
   * Extracted as a pure function for testability.
   *
   * Req 14.2: (customers with >1 visit in 90d) / (total unique customers in 90d)
   */
  static computeRetentionRate(customerVisitCounts: number[]): number {
    if (customerVisitCounts.length === 0) return 0;
    const totalUnique = customerVisitCounts.length;
    const returning = customerVisitCounts.filter((count) => count > 1).length;
    return totalUnique > 0 ? returning / totalUnique : 0;
  }

  /**
   * Filter job cards to only include COMPLETED or INVOICED status.
   * Extracted as a pure function for testability.
   *
   * Req 14.5: Only COMPLETED/INVOICED
   */
  static filterAnalyticsEligibleStatuses(statuses: string[]): string[] {
    return statuses.filter((s) => ANALYTICS_STATUSES.includes(s as any));
  }

  private computeRevenueBreakdown(
    invoicedCards: Array<{ invoice: { totalPaise: number } | null; updatedAt: Date }>,
    period: 'daily' | 'weekly' | 'monthly',
  ): RevenueBreakdown[] {
    const periodMap = new Map<string, number>();

    for (const jc of invoicedCards) {
      if (!jc.invoice) continue;
      const date = jc.updatedAt;
      let label: string;

      switch (period) {
        case 'daily':
          label = date.toISOString().slice(0, 10);
          break;
        case 'weekly': {
          // ISO week
          const d = new Date(date);
          d.setHours(0, 0, 0, 0);
          d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
          const week1 = new Date(d.getFullYear(), 0, 4);
          const weekNum = Math.ceil(
            ((d.getTime() - week1.getTime()) / 86400000 + week1.getDay() + 1) / 7,
          );
          label = `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
          break;
        }
        case 'monthly':
          label = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          break;
      }

      periodMap.set(label, (periodMap.get(label) ?? 0) + jc.invoice.totalPaise);
    }

    return Array.from(periodMap.entries())
      .map(([periodLabel, totalPaise]) => ({ periodLabel, totalPaise }))
      .sort((a, b) => a.periodLabel.localeCompare(b.periodLabel));
  }

  private async computeRevenueByCategory(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<RevenueByCategoryItem[]> {
    const jobCardItems = await this.prisma.jobCardItem.findMany({
      where: {
        jobCard: {
          tenantId,
          status: { in: [...ANALYTICS_STATUSES] },
          updatedAt: { gte: from, lte: to },
        },
      },
      include: {
        service: { select: { category: true } },
      },
    });

    const categoryRevenue = new Map<string, number>();
    for (const item of jobCardItems) {
      const category = item.service.category || 'uncategorized';
      categoryRevenue.set(category, (categoryRevenue.get(category) ?? 0) + item.pricePaise);
    }

    return Array.from(categoryRevenue.entries())
      .map(([category, totalPaise]) => ({ category, totalPaise }))
      .sort((a, b) => b.totalPaise - a.totalPaise);
  }

  private resolveDefaultDateRange(from?: string, to?: string): { from: Date; to: Date } {
    const now = new Date();
    const dateTo = to ? new Date(to) : now;
    // Default: last 12 months
    const defaultFrom = new Date(now);
    defaultFrom.setMonth(defaultFrom.getMonth() - 12);
    const dateFrom = from ? new Date(from) : defaultFrom;

    return { from: dateFrom, to: dateTo };
  }

  private requireTenant(): string {
    const tenantId = this.tenantContext.tenantId;
    if (!tenantId) {
      throw ApiException.validation('Tenant context is required.');
    }
    return tenantId;
  }
}
