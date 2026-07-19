import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { TenantModule } from './common/tenant/tenant.module';
import { TenantContextInterceptor } from './common/interceptors/tenant-context.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { MeModule } from './modules/me/me.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { ManageModule } from './modules/manage/manage.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { EventsModule } from './modules/events/events.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { VehicleRecordsModule } from './modules/vehicle-records/vehicle-records.module';
import { JobCardsModule } from './modules/job-cards/job-cards.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { InvoicingModule } from './modules/invoicing/invoicing.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { HealthScoreModule } from './modules/health-score/health-score.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { FleetModule } from './modules/fleet/fleet.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { MigrationModule } from './modules/migration/migration.module';
import { DocumentsModule } from './modules/documents/documents.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('jwt.secret'),
      }),
    }),
    PrismaModule,
    TenantModule,
    EventsModule,
    AuthModule,
    MeModule,
    CatalogModule,
    VehiclesModule,
    BookingsModule,
    ManageModule,
    TasksModule,
    TenantsModule,
    VehicleRecordsModule,
    JobCardsModule,
    InventoryModule,
    InvoicingModule,
    NotificationsModule,
    HealthScoreModule,
    MaintenanceModule,
    AppointmentsModule,
    FleetModule,
    AnalyticsModule,
    MigrationModule,
    DocumentsModule,
  ],
  providers: [
    // Order matters: authenticate first, resolve tenant context, then check roles and tenant membership.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
  ],
})
export class AppModule {}
