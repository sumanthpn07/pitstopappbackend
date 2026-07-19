import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators';
import type { AuthContext } from '../../common/auth.types';
import { NotificationsService } from './notifications.service';
import type { UpdatePreferencesDto } from './dto';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /** Get the current user's notification preferences. */
  @Get('preferences')
  getPreferences(@CurrentUser() auth: AuthContext) {
    return this.notificationsService.getPreferences(auth.userId);
  }

  /** Update the current user's notification preferences. */
  @Patch('preferences')
  @HttpCode(HttpStatus.OK)
  updatePreferences(
    @CurrentUser() auth: AuthContext,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.notificationsService.updatePreferences(auth.userId, dto);
  }
}
