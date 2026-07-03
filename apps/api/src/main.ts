import 'reflect-metadata';
import fastifyCookie from '@fastify/cookie';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { registerHttpAccessLogger } from './common/logging/http-access-logger';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  const config = app.get(AppConfigService);

  // Cookie support must be registered before the app starts handling requests.
  await app.register(fastifyCookie, { secret: config.cookieSecret });

  app.setGlobalPrefix(config.apiPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableCors({ origin: config.frontendUrl, credentials: true });

  // One log line per HTTP request so every frontend call is visible on the backend.
  registerHttpAccessLogger(app.getHttpAdapter().getInstance());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('AI World Cup Analyst API')
    .setDescription('Backend API for the AI World Cup Analyst platform')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(config.port, '0.0.0.0');
  Logger.log(
    `API listening on http://localhost:${config.port}/${config.apiPrefix} (docs: /docs)`,
    'Bootstrap',
  );
}

void bootstrap();
