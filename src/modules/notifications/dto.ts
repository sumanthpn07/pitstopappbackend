import { NotificationChannel } from '@prisma/client';

export interface UpdatePreferenceDto {
  eventType: string;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface UpdatePreferencesDto {
  preferences: UpdatePreferenceDto[];
}
