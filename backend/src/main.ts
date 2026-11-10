import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use(cookieParser());

  // Security headers — proposed 🟡
  app.use(helmet());

  // Global DTO validation — server-side is authoritative (SRS V2 NFR-015)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,      // strip unknown fields (mass-assignment protection)
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // API versioning — /api/v1/... (SYSTEM_ARCH §11)
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // OpenAPI — dev/staging only; never expose in production without auth
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('HMS API')
      .setDescription('Hostel Management System API — core operations, finance, mess, complaints, and notices')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  // CORS — restrict in production to known origins (🟡 origins to be configured)
  app.enableCors({
    origin: process.env.NODE_ENV === 'production'
      ? (process.env.CORS_ORIGINS ?? '').split(',')
      : true,
    credentials: true,
  });

  const port = parseInt(process.env.PORT ?? '3001', 10);
  await app.listen(port);
  console.log(`HMS API running on port ${port} [${process.env.NODE_ENV}]`);
}

bootstrap();
