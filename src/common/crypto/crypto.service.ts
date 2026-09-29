import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly encryptionKey: Buffer;

  constructor(configService: ConfigService) {
    const raw = configService.get<string>('ENCRYPTION_KEY') || configService.get<string>('JWT_SECRET') || 'eat-app-default-key';
    this.encryptionKey = createHash('sha256').update(raw).digest();
  }

  /**
   * Chiffre un texte en AES-256-GCM.
   * Retourne une chaîne base64 au format `iv:tag:ciphertext`.
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.encryptionKey, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    const payload = Buffer.concat([iv, tag, encrypted]);
    return payload.toString('base64');
  }

  /**
   * Déchiffre une chaîne au format `iv:tag:ciphertext` (base64).
   */
  decrypt(payload: string): string {
    const raw = Buffer.from(payload, 'base64');

    const iv = raw.subarray(0, IV_LENGTH);
    const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = raw.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(tag);

    return decipher.update(encrypted, undefined as any, 'utf8') + decipher.final('utf8');
  }
}