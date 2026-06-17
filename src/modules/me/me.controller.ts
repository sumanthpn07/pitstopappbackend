import { Body, Controller, Get, Patch } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser } from '../../common/decorators';
import { ApiException } from '../../common/api-exception';
import type { AuthContext } from '../../common/auth.types';
import { serializeMe } from '../../domain/serializers';
import type { MeDTO } from '../../domain/contracts';
import { UpdateMeDto } from './dto';

@Controller('me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async me(@CurrentUser() auth: AuthContext): Promise<MeDTO> {
    const user = await this.prisma.user.findUnique({
      where: { id: auth.userId },
      include: { memberships: { include: { shop: true } }, identities: true },
    });
    if (!user) throw ApiException.unauthorized();
    return serializeMe(user);
  }

  @Patch()
  async update(@CurrentUser() auth: AuthContext, @Body() dto: UpdateMeDto): Promise<MeDTO> {
    const user = await this.prisma.user.update({
      where: { id: auth.userId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() || null } : {}),
        ...(dto.email !== undefined ? { email: dto.email.trim() || null } : {}),
      },
      include: { memberships: { include: { shop: true } }, identities: true },
    });
    return serializeMe(user);
  }
}
