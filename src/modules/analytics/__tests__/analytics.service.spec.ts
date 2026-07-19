import { describe, it, expect } from 'vitest';
import { AnalyticsService } from '../analytics.service';

describe('AnalyticsService', () => {
  describe('computeRetentionRate', () => {
    it('should return 0 when no customers', () => {
      expect(AnalyticsService.computeRetentionRate([])).toBe(0);
    });

    it('should return 0 when all customers visited only once', () => {
      // 5 customers, each visited once
      const visits = [1, 1, 1, 1, 1];
      expect(AnalyticsService.computeRetentionRate(visits)).toBe(0);
    });

    it('should return 1 when all customers visited more than once', () => {
      // 3 customers, each visited multiple times
      const visits = [2, 3, 5];
      expect(AnalyticsService.computeRetentionRate(visits)).toBe(1);
    });

    it('should compute correct ratio for mixed visits', () => {
      // 4 customers total: 2 with >1 visit, 2 with exactly 1 visit
      // Retention = 2/4 = 0.5
      const visits = [1, 2, 1, 3];
      expect(AnalyticsService.computeRetentionRate(visits)).toBe(0.5);
    });

    it('should compute retention rate for realistic scenario', () => {
      // 10 customers: 3 returning (visits > 1), 7 one-time
      // Retention = 3/10 = 0.3
      const visits = [1, 1, 2, 1, 3, 1, 1, 4, 1, 1];
      expect(AnalyticsService.computeRetentionRate(visits)).toBeCloseTo(0.3);
    });

    it('should handle single customer with one visit', () => {
      expect(AnalyticsService.computeRetentionRate([1])).toBe(0);
    });

    it('should handle single customer with multiple visits', () => {
      expect(AnalyticsService.computeRetentionRate([5])).toBe(1);
    });

    it('should return a value between 0 and 1 inclusive', () => {
      const visits = [1, 2, 3, 1, 1, 2];
      const rate = AnalyticsService.computeRetentionRate(visits);
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    });
  });

  describe('filterAnalyticsEligibleStatuses', () => {
    it('should keep only COMPLETED and INVOICED statuses', () => {
      const statuses = ['CREATED', 'ASSIGNED', 'IN_PROGRESS', 'QUALITY_CHECK', 'COMPLETED', 'INVOICED', 'CANCELLED'];
      const result = AnalyticsService.filterAnalyticsEligibleStatuses(statuses);
      expect(result).toEqual(['COMPLETED', 'INVOICED']);
    });

    it('should return empty array when no valid statuses', () => {
      const statuses = ['CREATED', 'ASSIGNED', 'IN_PROGRESS', 'CANCELLED'];
      const result = AnalyticsService.filterAnalyticsEligibleStatuses(statuses);
      expect(result).toEqual([]);
    });

    it('should return all when all are valid', () => {
      const statuses = ['COMPLETED', 'INVOICED', 'COMPLETED'];
      const result = AnalyticsService.filterAnalyticsEligibleStatuses(statuses);
      expect(result).toEqual(['COMPLETED', 'INVOICED', 'COMPLETED']);
    });

    it('should handle empty array', () => {
      expect(AnalyticsService.filterAnalyticsEligibleStatuses([])).toEqual([]);
    });

    it('should exclude QUALITY_CHECK status', () => {
      const statuses = ['QUALITY_CHECK', 'COMPLETED'];
      const result = AnalyticsService.filterAnalyticsEligibleStatuses(statuses);
      expect(result).toEqual(['COMPLETED']);
    });

    it('should exclude CANCELLED status', () => {
      const statuses = ['CANCELLED', 'INVOICED'];
      const result = AnalyticsService.filterAnalyticsEligibleStatuses(statuses);
      expect(result).toEqual(['INVOICED']);
    });
  });
});
