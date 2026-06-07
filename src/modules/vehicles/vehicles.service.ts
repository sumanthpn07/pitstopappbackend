import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api-exception';
import { membershipForRole, type AuthContext, type AuthMembership } from '../../common/auth.types';
import { serializeVehicle } from '../../domain/serializers';
import type { VehicleDTO } from '../../domain/contracts';
import type { CreateVehicleDto } from './dto';

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  private customerMembership(auth: AuthContext): AuthMembership {
    const m = membershipForRole(auth, Role.CUSTOMER);
    if (!m) throw ApiException.forbidden('No customer access.');
    return m;
  }

  async list(auth: AuthContext): Promise<VehicleDTO[]> {
    const m = this.customerMembership(auth);
    const rows = await this.prisma.vehicle.findMany({
      where: { membershipId: m.id },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(serializeVehicle);
  }

  async create(auth: AuthContext, dto: CreateVehicleDto): Promise<VehicleDTO> {
    const m = this.customerMembership(auth);
    const vehicle = await this.prisma.vehicle.create({
      data: {
        membershipId: m.id,
        makeModel: dto.makeModel.trim(),
        plate: dto.plate?.trim() || null,
        color: dto.color?.trim() || null,
        type: dto.type?.trim() || null,
      },
    });
    return serializeVehicle(vehicle);
  }

  async remove(auth: AuthContext, id: string): Promise<void> {
    const m = this.customerMembership(auth);
    // Scope the delete to the signed-in customer's own vehicles.
    await this.prisma.vehicle.deleteMany({ where: { id, membershipId: m.id } });
  }
}
