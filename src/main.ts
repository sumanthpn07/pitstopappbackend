import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { LoggingInterceptor } from './common/logging.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  const corsOrigins = config.getOrThrow<string>('corsOrigins');
  app.enableCors({
    origin: corsOrigins === '*' ? true : corsOrigins.split(',').map((s) => s.trim()),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  if (config.getOrThrow<boolean>('logRequests')) {
    app.useGlobalInterceptors(new LoggingInterceptor());
    new Logger('Bootstrap').log('Request/response logging is ON (LOG_REQUESTS=true)');
  }

  const port = config.getOrThrow<number>('port');
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`PitStop API listening on http://localhost:${port}`);
}

void bootstrap();
