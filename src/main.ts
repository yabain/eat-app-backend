import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { existsSync, mkdirSync } from 'fs';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { resolveUploadDir } from './common/utils/upload-dir.util';

function corsOrigins() {
  const configuredOrigins = [
    process.env.FRONTEND_URL,
    ...(process.env.CORS_ORIGINS || '').split(','),
  ]
    .map((origin) => origin?.trim().replace(/\/+$/, ''))
    .filter(Boolean) as string[];

  return new Set([
    'https://eat.yaba-in.com',
    'http://localhost:4200',
    'http://localhost:5173',
    ...configuredOrigins,
  ]);
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const allowedOrigins = corsOrigins();
  const corsMethods = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS';
  const corsHeaders = 'Origin, X-Requested-With, Content-Type, Accept, Authorization';

  app.use((req, res, next) => {
    const origin = req.headers.origin?.replace(/\/+$/, '');
    if (origin && allowedOrigins.has(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', corsMethods);
      res.header('Access-Control-Allow-Headers', corsHeaders);
    }

    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const normalizedOrigin = origin.replace(/\/+$/, '');
      return callback(null, allowedOrigins.has(normalizedOrigin));
    },
    credentials: true,
    methods: corsMethods,
    allowedHeaders: corsHeaders,
    optionsSuccessStatus: 204,
  });
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
