import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser } from '../../common/decorators';
import { ApiException } from '../../common/api-exception';
import type { AuthContext } from '../../common/auth.types';
import { serializeMe } from '../../domain/serializers';
import type { MeDTO } from '../../domain/contracts';

@Controller('me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async me(@CurrentUser() auth: AuthContext): Promise<MeDTO> {
    const user = await this.prisma.user.findUnique({
      where: { id: auth.userId },
      include: { memberships: { include: { shop: true } } },
    });
    if (!user) throw ApiException.unauthorized();
    return serializeMe(user);
  }
}
