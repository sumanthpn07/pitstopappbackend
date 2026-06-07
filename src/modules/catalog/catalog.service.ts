import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookingStatus, type Shop } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api-exception';
import { computeSlots } from '../../domain/availability';
import { endOfDayUtc, isValidDateKey, startOfDayUtc, weekdayOf } from '../../domain/datetime';
import { serializeOffer, serializeService, serializeShop } from '../../domain/serializers';
import type { AvailabilitySlotDTO, OfferDTO, ServiceDTO, ShopDTO } from '../../domain/contracts';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private async resolveShop(): Promise<Shop> {
    const id = this.config.getOrThrow<string>('defaultShopId');
    const shop =
      (await this.prisma.shop.findUnique({ where: { id } })) ??
      (await this.prisma.shop.findFirst());
    if (!shop) throw ApiException.notFound('Shop not found.');
    return shop;
  }

  async getShop(): Promise<ShopDTO> {
    return serializeShop(await this.resolveShop());
  }

  async getActiveServices(): Promise<ServiceDTO[]> {
    const shop = await this.resolveShop();
    const rows = await this.prisma.service.findMany({
      where: { shopId: shop.id, active: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(serializeService);
  }

  async getOffers(): Promise<OfferDTO[]> {
    const shop = await this.resolveShop();
    const rows = await this.prisma.offer.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(serializeOffer);
  }

  async getAvailability(serviceId: string, dateKey: string): Promise<AvailabilitySlotDTO[]> {
    if (!serviceId || !dateKey || !isValidDateKey(dateKey)) {
      throw ApiException.validation('A serviceId and valid date (YYYY-MM-DD) are required.');
    }
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, active: true },
    });
    if (!service) throw ApiException.notFound('Service not found.');

    const shop = await this.prisma.shop.findUnique({ where: { id: service.shopId } });
    if (!shop) throw ApiException.notFound('Shop not found.');

    const day = weekdayOf(dateKey, shop.timezone);
    const wh = await this.prisma.workingHour.findUnique({
      where: { shopId_day: { shopId: shop.id, day } },
    });
    if (!wh || wh.closed) return [];

    const bookings = await this.prisma.booking.findMany({
      where: {
        shopId: shop.id,
        status: { notIn: [BookingStatus.CANCELLED, BookingStatus.NO_SHOW] },
        scheduledAt: {
          gte: startOfDayUtc(dateKey, shop.timezone),
          lte: endOfDayUtc(dateKey, shop.timezone),
        },
      },
      select: { scheduledAt: true, durationMin: true },
    });
    const windows = bookings.map((b) => ({
      startMs: b.scheduledAt.getTime(),
      endMs: b.scheduledAt.getTime() + b.durationMin * 60_000,
    }));

    return computeSlots({
      dateKey,
      zone: shop.timezone,
      open: wh.open,
      close: wh.close,
      capacity: wh.capacity,
      durationMin: service.durationMin,
      now: new Date(),
      bookings: windows,
    });
  }
}
