import { Prisma } from '@prisma/client';

/**
 * List of Prisma model names that are tenant-scoped (have a required tenantId).
 * These models will have automatic WHERE tenantId filtering applied.
 *
 * Models with optional tenantId (ServiceEvent, Notification) are NOT included
 * because they may legitimately exist without a tenant scope.
 */
const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set([
  'JobCard',
  'InventoryItem',
  'Invoice',
  'TenantService',
  'TenantWorkingHour',
  'TenantMembership',
  'MaintenanceTemplate',
  'TenantFinanceTxn',
]);

/**
 * Creates a Prisma client extension that automatically injects tenantId
 * filtering on all read/write operations for tenant-scoped models.
 *
 * This enforces row-level data isolation (Requirement 5.5) by ensuring
 * that queries cannot accidentally access data belonging to another tenant.
 *
 * @param tenantId - The active tenant ID for the current request
 */
export function tenantPrismaExtension(tenantId: string) {
  return Prisma.defineExtension({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          if (TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, tenantId };
          }
          return query(args);
        },
        async findFirst({ model, args, query }) {
          if (TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, tenantId };
          }
          return query(args);
        },
        async findUnique({ model, args, query }) {
          // findUnique uses unique fields — we validate after fetch
          // to avoid breaking unique-where constraints.
          const result = await query(args);
          if (TENANT_SCOPED_MODELS.has(model) && result) {
            const record = result as Record<string, unknown>;
            if (record['tenantId'] !== tenantId) {
              return null;
            }
          }
          return result;
        },
        async findFirstOrThrow({ model, args, query }) {
          if (TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, tenantId };
          }
          return query(args);
        },
        async findUniqueOrThrow({ model, args, query }) {
          const result = await query(args);
          if (TENANT_SCOPED_MODELS.has(model) && result) {
            const record = result as Record<string, unknown>;
            if (record['tenantId'] !== tenantId) {
              throw new Error('Record not found');
            }
          }
          return result;
        },
        async count({ model, args, query }) {
          if (TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, tenantId };
          }
          return query(args);
        },
        async aggregate({ model, args, query }) {
          if (TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, tenantId };
          }
          return query(args);
        },
        async groupBy({ model, args, query }) {
          if (TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, tenantId };
          }
          return query(args);
        },
        async create({ model, args, query }) {
          if (TENANT_SCOPED_MODELS.has(model)) {
            args.data = { ...args.data, tenantId };
          }
          return query(args);
        },
        async createMany({ model, args, query }) {
          if (TENANT_SCOPED_MODELS.has(model)) {
            if (Array.isArray(args.data)) {
              args.data = args.data.map((item) => ({ ...item, tenantId }));
            } else {
              args.data = { ...args.data, tenantId };
            }
          }
          return query(args);
        },
        async update({ model, args, query }) {
          if (TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, tenantId } as typeof args.where;
          }
          return query(args);
        },
        async updateMany({ model, args, query }) {
          if (TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, tenantId };
          }
          return query(args);
        },
        async delete({ model, args, query }) {
          if (TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, tenantId } as typeof args.where;
          }
          return query(args);
        },
        async deleteMany({ model, args, query }) {
          if (TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, tenantId };
          }
          return query(args);
        },
        async upsert({ model, args, query }) {
          if (TENANT_SCOPED_MODELS.has(model)) {
            args.where = { ...args.where, tenantId } as typeof args.where;
            args.create = { ...args.create, tenantId };
          }
          return query(args);
        },
      },
    },
  });
}
