import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { isAbsolute, join } from 'path';
import * as QRCode from 'qrcode';
import { Client, LocalAuth } from 'whatsapp-web.js';

type WhatsappConnectionStatus = 'initializing' | 'qr' | 'authenticated' | 'ready' | 'disconnected' | 'failed';

@Injectable()
export class WhatsappService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappService.name);
  private client: Client | null = null;
  private status: WhatsappConnectionStatus = 'disconnected';
  private qrCode: string | null = null;
  private qrCodeDataUrl: string | null = null;
  private connectedNumber: string | null = null;
  private lastError: string | null = null;
  private initializing = false;
  private readyWatchdog: NodeJS.Timeout | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    if (this.useGateway()) {
      this.logger.log(`WhatsApp gateway enabled: ${this.gatewayBaseUrl()}`);
      return;
    }
    if (this.configService.get<string>('WHATSAPP_AUTO_INIT', 'true') === 'false') return;
    void this.initialize().catch((error) => {
      this.status = 'failed';
      this.lastError = error?.message || String(error);
      this.logger.warn(`WhatsApp initialization skipped: ${this.lastError}`);
    });
  }

  async onModuleDestroy() {
    await this.destroyClient();
  }

  async getStatus() {
    if (this.useGateway()) return this.safeGatewayStatus('status');
    await this.refreshRuntimeState();
    return {
      status: this.status,
      connected: this.status === 'ready',
      hasQr: !!this.qrCodeDataUrl,
      connectedNumber: this.connectedNumber,
      lastError: this.lastError,
    };
  }

  async getQr() {
    if (this.useGateway()) return this.safeGatewayStatus('qr');
    if (!this.client && !this.initializing) await this.initialize();
    await this.refreshRuntimeState();
    return {
      status: this.status,
      qr: this.qrCode,
      qrDataUrl: this.qrCodeDataUrl,
      connected: this.status === 'ready',
      connectedNumber: this.connectedNumber,
      lastError: this.lastError,
    };
  }

  async reset() {
    if (this.useGateway()) return this.safeGatewayStatus('reset', { method: 'POST' });
    await this.destroyClient();
    const authPath = this.getAuthDataPath();
    const removed = this.removeAuthData(authPath);
    this.qrCode = null;
    this.qrCodeDataUrl = null;
    this.connectedNumber = null;
    this.status = 'disconnected';

    if (!removed) {
      this.status = 'failed';
      return this.getStatus();
    }

    this.lastError = null;
    await this.initialize();
    return this.getStatus();
  }

  async sendText(phone: string, message: string) {
    if (this.useGateway()) {
      return this.gatewayRequest('send-text', {
        method: 'POST',
        body: JSON.stringify({ phone, message }),
      });
    }
    if (!this.client || this.status !== 'ready') {
      throw new BadRequestException(`WhatsApp is not ready${this.status ? ` (current status: ${this.status})` : ''}`);
    }
    const candidates = this.buildPhoneCandidates(phone);
    const errors: string[] = [];

    for (const candidate of candidates) {
      try {
        const numberId = await this.client.getNumberId(candidate).catch(() => null);
        const chatId = numberId?._serialized || `${candidate}@c.us`;
        await this.client.sendMessage(chatId, message);
        return { sent: true, to: chatId, attemptedNumbers: candidates };
      } catch (error) {
        if (String(error?.message || error).includes('getChat')) {
          this.status = 'authenticated';
          this.lastError = 'WhatsApp Web is connected but not ready to send messages yet. Wait for ready status or reset the connection.';
        }
        errors.push(`${candidate}: ${error?.message || error}`);
      }
    }

    throw new BadRequestException(`Unable to send WhatsApp message. Attempts: ${errors.join(' | ')}`);
  }

  private async initialize() {
    if (this.initializing || this.client) return;
    this.initializing = true;
    this.status = 'initializing';
    this.lastError = null;

    try {
      const authPath = this.getAuthDataPath();
      mkdirSync(authPath, { recursive: true });

      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: 'eat-app',
          dataPath: authPath,
        }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
          ],
        },
      });

      this.registerEvents(this.client);
      await this.client.initialize();
    } catch (error) {
      this.status = 'failed';
      this.lastError = error?.message || String(error);
      this.logger.warn(`Unable to initialize WhatsApp client: ${this.lastError}`);
      this.client = null;
    } finally {
      this.initializing = false;
    }
  }

  private useGateway() {
    return !!this.gatewayBaseUrl() && this.configService.get<string>('WHATSAPP_LOCAL_ENABLED', 'false') !== 'true';
  }

  private gatewayBaseUrl() {
    return this.normalizeUrl(this.configService.get<string>('WHATSAPP_GATEWAY_URL'));
  }

  private gatewayPassword() {
    return this.configService.get<string>('WHATSAPP_GATEWAY_PASSWORD') || '123Whatsapp?';
  }

  private async gatewayRequest(path: string, init: RequestInit = {}) {
    const baseUrl = this.gatewayBaseUrl();
    if (!baseUrl) throw new BadRequestException('WhatsApp gateway URL is not configured');

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/${path.replace(/^\/+/, '')}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          'x-whatsapp-password': this.gatewayPassword(),
          ...(init.headers || {}),
        },
      });
    } catch (error: any) {
      throw new BadRequestException(`WhatsApp gateway unreachable: ${error?.message || error}`);
    }
    const text = await response.text();
    const data = text ? this.parseGatewayJson(text) : {};

    if (!response.ok) {
      throw new BadRequestException(data?.message || data?.error || `WhatsApp gateway error (${response.status})`);
    }
    return data;
  }

  private async safeGatewayStatus(path: string, init: RequestInit = {}) {
    try {
      return await this.gatewayRequest(path, init);
    } catch (error: any) {
      const message = error?.response?.message || error?.message || String(error);
      this.logger.warn(message);
      return {
        status: 'failed',
        connected: false,
        hasQr: false,
        qr: null,
        qrDataUrl: null,
        connectedNumber: null,
        lastError: message,
      };
    }
  }

  private parseGatewayJson(text: string) {
    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  }

  private normalizeUrl(url?: string) {
    const value = String(url || '').trim().replace(/\/+$/, '');
    if (!value) return '';
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  }

  private registerEvents(client: Client) {
    client.on('qr', async (qr) => {
      this.status = 'qr';
      this.qrCode = qr;
      this.qrCodeDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      this.logger.log('WhatsApp QR code generated');
    });

    client.on('authenticated', () => {
      this.status = 'authenticated';
      this.lastError = null;
      this.logger.log('WhatsApp authenticated');
      this.scheduleReadyWatchdog();
    });

    client.on('ready', () => {
      this.clearReadyWatchdog();
      this.status = 'ready';
      this.qrCode = null;
      this.qrCodeDataUrl = null;
      this.connectedNumber = this.client?.info?.wid?.user || null;
      this.logger.log(`WhatsApp ready${this.connectedNumber ? ` as ${this.connectedNumber}` : ''}`);
    });

    client.on('disconnected', (reason) => {
      this.clearReadyWatchdog();
      this.status = 'disconnected';
      this.connectedNumber = null;
      this.lastError = reason || null;
      this.qrCode = null;
      this.qrCodeDataUrl = null;
      this.client = null;
      this.logger.warn(`WhatsApp disconnected: ${reason}`);
    });

    client.on('auth_failure', (message) => {
      this.clearReadyWatchdog();
      this.status = 'failed';
      this.lastError = message || 'Authentication failed';
      this.logger.warn(`WhatsApp authentication failed: ${this.lastError}`);
    });
  }

  private async destroyClient() {
    this.clearReadyWatchdog();
    if (!this.client) return;
    try {
      await this.client.destroy();
    } catch (error) {
      this.logger.warn(`Unable to destroy WhatsApp client: ${error?.message || error}`);
    } finally {
      this.client = null;
      this.initializing = false;
    }
  }

  private removeAuthData(authPath: string) {
    if (!existsSync(authPath)) return true;
    try {
      rmSync(authPath, { recursive: true, force: true });
      return true;
    } catch (error: any) {
      this.lastError = [
        `Unable to reset WhatsApp session at ${authPath}: ${error?.message || error}`,
        'Stop every running backend/Chrome process using this session, then fix directory permissions or remove it manually.',
      ].join(' ');
      this.logger.warn(this.lastError);
      return false;
    }
  }

  private scheduleReadyWatchdog() {
    this.clearReadyWatchdog();
    const timeoutMs = Number(this.configService.get<string>('WHATSAPP_READY_TIMEOUT_MS') || 90000);
    this.readyWatchdog = setTimeout(() => {
      if (this.status !== 'authenticated') return;
      this.lastError = `WhatsApp authenticated but not ready after ${Math.round(timeoutMs / 1000)}s. Restarting client.`;
      this.logger.warn(this.lastError);
      void this.restartClient();
    }, timeoutMs);
  }

  private clearReadyWatchdog() {
    if (!this.readyWatchdog) return;
    clearTimeout(this.readyWatchdog);
    this.readyWatchdog = null;
  }

  private async restartClient() {
    await this.destroyClient();
    this.status = 'disconnected';
    await this.initialize();
  }

  private async refreshRuntimeState() {
    if (!this.client || this.status === 'ready') return;
    try {
      const state = await this.client.getState();
      if (state === 'CONNECTED' && this.status === 'qr') {
        this.status = 'authenticated';
        this.qrCode = null;
        this.qrCodeDataUrl = null;
        this.lastError = 'WhatsApp session is authenticated; waiting for WhatsApp Web to become ready.';
        this.scheduleReadyWatchdog();
      }
    } catch {
      // getState can fail while WhatsApp Web is still booting.
    }
  }

  private getAuthDataPath() {
    const configured = this.configService.get<string>('WHATSAPP_SESSION_DIR') || 'whatsapp-session';
    if (configured === '/whatsapp-session') return join(process.cwd(), 'whatsapp-session');
    return isAbsolute(configured) ? configured : join(process.cwd(), configured);
  }

  private buildPhoneCandidates(phone: string) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) throw new BadRequestException('Phone number is required');

    const candidates = [digits];
    if (digits.startsWith('2376') && digits.length === 12) {
      candidates.push(`237${digits.slice(4)}`);
    }
    if (digits.startsWith('6') && digits.length === 9) {
      candidates.push(`237${digits}`);
      candidates.push(`237${digits.slice(1)}`);
    }

    return [...new Set(candidates)];
  }
}
