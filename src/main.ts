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

  // Middleware de pré-vol : on intercepte les OPTIONS le PLUS TÔT possible
  // avant tout guard/interceptor NestJS, et on renvoie 204 inconditionnellement
  // pour que le navigateur valide le preflight. Si l'origine est en liste
  // blanche, on positionne les en-têtes Access-Control-Allow-*. Sinon on
  // retourne 204 sans les en-têtes — le navigateur bloquera la requête
  // suivante (XHR) avec un message clair, mais le preflight lui-même réussit.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const isAllowed = typeof origin === 'string' && isAllowedCorsOrigin(origin, allowedOrigins);
    if (isAllowed && typeof origin === 'string') {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', CORS_METHODS);
      res.setHeader(
        'Access-Control-Allow-Headers',
        // Reflète les headers demandés si fournis (utile pour les preflights
        // avec headers custom non explicitement listés), sinon liste blanche.
        String(req.headers['access-control-request-headers'] || allowedHeaders.join(',')),
      );
      res.setHeader('Access-Control-Max-Age', '86400');
      res.setHeader('Vary', 'Origin, Access-Control-Request-Headers');
    }

    if (req.method === 'OPTIONS') {
      // 204 No Content — preflight terminé, pas de body.
      res.statusCode = 204;
      res.setHeader('Content-Length', '0');
      return res.end();
    }

    next();
  });

  // Backup CORS via NestJS au cas où un endpoint contourne le middleware
  // ci-dessus (très rare). Configure aussi le passthrough préflight.
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      return callback(null, isAllowedCorsOrigin(origin, allowedOrigins));
    },
    credentials: true,
    methods: CORS_METHODS,
    allowedHeaders,
    optionsSuccessStatus: 204,
    preflightContinue: false,
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
