import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser, Public } from '../../common/decorators';
import type { AuthContext } from '../../common/auth.types';
import { AuthService } from './auth.service';
import {
  FirebaseLoginDto,
  LinkFirebaseDto,
  OtpRequestDto,
  OtpVerifyDto,
  RefreshDto,
  SwitchTenantDto,
  UnlinkDto,
} from './dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  requestOtp(@Body() dto: OtpRequestDto) {
    return this.auth.requestOtp(dto);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body() dto: OtpVerifyDto) {
    return this.auth.verifyOtp(dto);
  }

  @Public()
  @Post('firebase')
  @HttpCode(HttpStatus.OK)
  loginWithFirebase(@Body() dto: FirebaseLoginDto) {
    return this.auth.loginWithFirebase(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  /** Link another login method to the signed-in account. Returns a merge
   *  confirmation (without merging) when the identity belongs to another account. */
  @Post('link')
  @HttpCode(HttpStatus.OK)
  link(@CurrentUser() auth: AuthContext, @Body() dto: LinkFirebaseDto) {
    return this.auth.linkFirebase(auth.userId, dto.idToken, dto.confirmMerge ?? false);
  }

  /** Remove a login method from the signed-in account (not the last one). */
  @Post('unlink')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unlink(@CurrentUser() auth: AuthContext, @Body() dto: UnlinkDto): Promise<void> {
    await this.auth.unlinkProvider(auth.userId, dto.provider);
  }

  /**
   * Returns the user's available tenants/roles for context selection.
   * The frontend calls this after login to know which context to operate in.
   * If the user has exactly one tenant membership, the frontend can auto-select.
   * If more than one, it presents a context selector.
   */
  @Get('context')
  @HttpCode(HttpStatus.OK)
  getContext(@CurrentUser() auth: AuthContext) {
    return this.auth.getContext(auth.userId);
  }

  /**
   * Validates that the user has a membership in the target tenant and returns
   * context details. The actual runtime switching happens via the x-tenant-id
   * header; this endpoint is for validation and obtaining tenant metadata.
   */
  @Post('switch-tenant')
  @HttpCode(HttpStatus.OK)
  switchTenant(@CurrentUser() auth: AuthContext, @Body() dto: SwitchTenantDto) {
    return this.auth.switchTenant(auth.userId, dto.tenantId);
  }
}
