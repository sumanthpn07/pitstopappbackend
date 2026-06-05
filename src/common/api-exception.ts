import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Domain error that serializes to the `{ error: { code, message } }` envelope
 * the mobile app expects. `code` mirrors the codes the app's mock used so the
 * client's user-facing messages line up.
 */
export class ApiException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ code, message }, status);
  }

  static unauthorized(message = 'Please sign in again.'): ApiException {
    return new ApiException('UNAUTHORIZED', message, HttpStatus.UNAUTHORIZED);
  }
  static forbidden(message = 'You don’t have access to that.'): ApiException {
    return new ApiException('FORBIDDEN', message, HttpStatus.FORBIDDEN);
  }
  static notFound(message = 'Not found.'): ApiException {
    return new ApiException('NOT_FOUND', message, HttpStatus.NOT_FOUND);
  }
  static validation(message = 'Invalid request.'): ApiException {
    return new ApiException('VALIDATION', message, HttpStatus.BAD_REQUEST);
  }
  static invalidTransition(message = 'That action isn’t allowed right now.'): ApiException {
    return new ApiException('INVALID_TRANSITION', message, HttpStatus.CONFLICT);
  }
  static otpInvalid(message = 'That code isn’t right. Try again.'): ApiException {
    return new ApiException('OTP_INVALID', message, HttpStatus.BAD_REQUEST);
  }
  static otpExpired(message = 'That code has expired. Request a new one.'): ApiException {
    return new ApiException('OTP_EXPIRED', message, HttpStatus.BAD_REQUEST);
  }
}
