import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

/**
 * Logs every incoming HTTP request and its outgoing response (status, body,
 * duration). Enabled only when `logRequests` config is true. Sensitive-looking
 * fields are masked and long strings (e.g. JWTs) are truncated so the log stays
 * readable while still showing the OTP `devCode` you need for login.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const { method, originalUrl } = req;
    const startedAt = Date.now();

    const reqBody = sanitize(req.body);
    this.logger.log(
      `→ ${method} ${originalUrl}` +
        (reqBody !== undefined ? ` body=${stringify(reqBody)}` : ''),
    );

    return next.handle().pipe(
      tap((data) => {
        const ms = Date.now() - startedAt;
        this.logger.log(
          `← ${method} ${originalUrl} ${res.statusCode} ${ms}ms ` +
            `resp=${stringify(sanitize(data))}`,
        );
      }),
      catchError((err) => {
        const ms = Date.now() - startedAt;
        const status = err?.status ?? err?.statusCode ?? 500;
        this.logger.warn(
          `← ${method} ${originalUrl} ${status} ${ms}ms ` +
            `error=${stringify(sanitize(err?.response ?? { message: err?.message }))}`,
        );
        return throwError(() => err);
      }),
    );
  }
}

const SENSITIVE = new Set(['password', 'authorization', 'codeHash']);
const TRUNCATE_OVER = 80;

/** Mask secret fields and truncate long strings (JWTs/refresh tokens). */
function sanitize(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > TRUNCATE_OVER ? `${value.slice(0, 12)}…[${value.length} chars]` : value;
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE.has(k) ? '***' : sanitize(v);
    }
    return out;
  }
  return value;
}

function stringify(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
