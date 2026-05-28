import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { existsSync, mkdirSync } from 'fs';
import * as cookieParser from 'cookie-parser';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  assertCorsOriginsConfigured,
  buildCorsOrigins,
  CORS_METHODS,
  corsAllowedHeaders,
} from './common/utils/cors.util';
import { resolveUploadDir } from './common/utils/upload-dir.util';

async function bootstrap() {
  const allowedOrigins = buildCorsOrigins();
  assertCorsOriginsConfigured(allowedOrigins);

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.enableCors({
    origin: (origin, callback) => {
      // Pas d'Origin : curl, webhooks, apps natives — CORS ne s'applique pas au navigateur.
      if (!origin) return callback(null, true);
      const normalizedOrigin = origin.replace(/\/+$/, '');
      return callback(null, allowedOrigins.has(normalizedOrigin));
    },
    credentials: true,
    methods: CORS_METHODS,
    allowedHeaders: corsAllowedHeaders(),
    optionsSuccessStatus: 204,
  });

  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Eat API')
    .setDescription('API de commande et livraison de repas')
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        in: 'header',
      },
      'bearer',
    )
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument, {
    swaggerOptions: { persistAuthorization: true },
  });

  const staticPath = resolveUploadDir();
  if (!existsSync(staticPath)) mkdirSync(staticPath, { recursive: true });
  app.useStaticAssets(staticPath, { prefix: '/uploads' });
  await app.listen(process.env.PORT || 3000);
}
bootstrap();
