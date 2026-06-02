import { RequestMethod, ValidationPipe } from '@nestjs/common';
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
  isAllowedCorsOrigin,
} from './common/utils/cors.util';
import { resolveUploadDir } from './common/utils/upload-dir.util';

async function bootstrap() {
  const allowedOrigins = buildCorsOrigins();
  assertCorsOriginsConfigured(allowedOrigins);

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const allowedHeaders = corsAllowedHeaders();

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && isAllowedCorsOrigin(origin, allowedOrigins)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', CORS_METHODS);
      res.setHeader('Access-Control-Allow-Headers', allowedHeaders.join(','));
      res.setHeader('Vary', 'Origin');
    }

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    next();
  });

  app.enableCors({
    origin: (origin, callback) => {
      // Pas d'Origin : curl, webhooks, apps natives — CORS ne s'applique pas au navigateur.
      if (!origin) return callback(null, true);
      return callback(null, isAllowedCorsOrigin(origin, allowedOrigins));
    },
    credentials: true,
    methods: CORS_METHODS,
    allowedHeaders,
    optionsSuccessStatus: 204,
  });

  app.use(cookieParser());
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'webhook/digikuntz', method: RequestMethod.POST }],
  });
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
