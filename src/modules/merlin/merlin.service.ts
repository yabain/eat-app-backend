import { Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import {
  MerlinConversation,
  MerlinConversationDocument,
} from '../../database/schemas/merlin-conversation.schema';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { AskMerlinDto } from './dto/ask-merlin.dto';
import { ContextBuilder } from './prompts/context.builder';
import { MERLIN_SYSTEM_PROMPT } from './prompts/system.prompt';

const RECIPE_KEYWORDS = /\b(recette|recettes|cuisiner|préparer|cuisson|ingrédient|ingrédients|comment.*faire|comment.*préparer|comment.*cuisiner)\b/i;
const MAX_MODELS = 5;
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODELS = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'google/gemma-4-31b-it:free',
  'deepseek/deepseek-v4-flash-0731:free',
  'cohere/north-mini-code:free',
  'thinkingmachines/inkling-small:free',
];
const PURGE_TIMEZONE = process.env.MERLIN_CRON_TIMEZONE || 'Africa/Douala';
const EMPTY_PAGE = { messages: [], total: 0 };

class MerlinUpstreamError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
    readonly status: number = 0,
  ) {
    super(message);
    this.name = 'MerlinUpstreamError';
  }
}

@Injectable()
export class MerlinService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(MerlinService.name);
  private recipesResource = '';
  private routesResource = '';
  private rotationCursor = 0;

  private runtimeConfig = {
    enabled: true,
    openRouterApiKey: '',
    temperature: 0.7,
    reasoningLevel: 'low',
  };

  constructor(
    @InjectModel(MerlinConversation.name)
    private conversationModel: Model<MerlinConversationDocument>,
    private config: ConfigService,
    private contextBuilder: ContextBuilder,
    private platformSettings: PlatformSettingsService,
  ) {}

  onModuleInit() {
    try {
      const recipesPath = path.join(__dirname, 'prompts/recettes_camerounaises_eat_app.txt');
      this.recipesResource = fs.readFileSync(recipesPath, 'utf-8');
      this.logger.log('Recettes camerounaises chargées');
    } catch {
      this.logger.warn('Fichier de recettes non trouvé');
    }
    try {
      const routesPath = path.join(__dirname, 'prompts/routes_eat_app.txt');
      this.routesResource = fs.readFileSync(routesPath, 'utf-8');
      this.logger.log('Routes Eat App chargées');
    } catch {
      this.logger.warn('Fichier de routes non trouvé');
    }

    void this.refreshRuntimeConfig().then(() => {
      if (!this.apiKey) {
        this.logger.warn(
          'Clé OpenRouter absente : Merlin ne pourra pas répondre (ni en base, ni en .env).',
        );
      }
      const models = this.modelCandidates;
      this.logger.log(
        `Merlin prêt — ${models.length} modèle(s) [${models.join(' → ')}], stratégie « ${this.modelStrategy} », exécution ${this.enabled ? 'activée' : 'DÉSACTIVÉE'}`,
      );
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      const result = await this.conversationModel.deleteMany({
        userId: null,
        $or: [{ visitorDate: { $lt: this.today() } }, { visitorDate: null }],
      });
      if (result.deletedCount) {
        this.logger.log(
          `Purge au démarrage : ${result.deletedCount} conversation(s) de visiteur(s) d'un jour précédent supprimée(s).`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Purge au démarrage ignorée : ${(error as Error).message}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    name: 'merlin-visitor-purge',
    timeZone: PURGE_TIMEZONE,
  })
  async purgeVisitorConversations(): Promise<void> {
    try {
      const result = await this.conversationModel.deleteMany({ userId: null });
      this.logger.log(
        `Purge de minuit : ${result.deletedCount ?? 0} conversation(s) de visiteur(s) supprimée(s).`,
      );
    } catch (error) {
      this.logger.error(
        `Purge des conversations visiteurs impossible : ${(error as Error).message}`,
      );
    }
  }

  private get timeZone(): string {
    return (this.config.get<string>('MERLIN_CRON_TIMEZONE') || 'Africa/Douala').trim();
  }

  private today(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  private visitorDateOf(visitorId: string): string | null {
    const match = /(\d{4}-\d{2}-\d{2})/.exec(visitorId);
    return match ? match[1] : null;
  }

  private get enabled(): boolean {
    return this.runtimeConfig.enabled;
  }

  private get apiKey(): string {
    return this.runtimeConfig.openRouterApiKey;
  }

  private get baseUrl(): string {
    const raw = (this.config.get<string>('MERLIN_BASE_URL') || DEFAULT_BASE_URL)
      .trim()
      .replace(/\/+$/, '');
    return /^https?:\/\/openrouter\.ai$/i.test(raw) ? `${raw}/api/v1` : raw;
  }

  private get siteUrl(): string {
    const raw =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:4200';
    return raw.split(',')[0].trim().replace(/\/$/, '');
  }

  private attributionHeaders(): Record<string, string> {
    return {
      'HTTP-Referer': this.toHeaderValue(this.siteUrl),
      'X-Title': this.toHeaderValue('Merlin AI - Eat App'),
    };
  }

  private toHeaderValue(value: string): string {
    return String(value).replace(/[^\x00-\xFF]/g, '-');
  }

  private get modelCandidates(): string[] {
    const raw =
      this.config.get<string>('MERLIN_MODELS') ||
      this.config.get<string>('MERLIN_MODEL') ||
      DEFAULT_MODELS.join(',');

    const models = [...new Set(raw.split(',').map((m) => m.trim()).filter(Boolean))];
    if (models.length > MAX_MODELS) {
      this.logger.warn(
        `MERLIN_MODELS contient ${models.length} modèles : seuls les ${MAX_MODELS} premiers seront utilisés.`,
      );
    }
    return models.slice(0, MAX_MODELS);
  }

  private get modelStrategy(): 'fallback' | 'round-robin' {
    return (this.config.get<string>('MERLIN_MODEL_STRATEGY') || 'fallback')
      .trim()
      .toLowerCase() === 'round-robin'
      ? 'round-robin'
      : 'fallback';
  }

  private orderedModels(): string[] {
    const models = this.modelCandidates;
    if (this.modelStrategy !== 'round-robin' || models.length < 2) {
      return models;
    }
    const start = this.rotationCursor++ % models.length;
    return [...models.slice(start), ...models.slice(0, start)];
  }

  private get temperature(): number {
    return this.runtimeConfig.temperature;
  }

  private get reasoningEffort(): string {
    return this.runtimeConfig.reasoningLevel;
  }

  private async refreshRuntimeConfig(): Promise<void> {
    const fromEnv = {
      enabled: (this.config.get<string>('MERLIN_ENABLED') ?? 'true') !== 'false',
      openRouterApiKey: this.config.get<string>('MERLIN_API_KEY')?.trim() ?? '',
      temperature: Number.isFinite(Number(this.config.get<string>('MERLIN_TEMPERATURE')))
        ? Number(this.config.get<string>('MERLIN_TEMPERATURE'))
        : 0.7,
      reasoningLevel: (this.config.get<string>('MERLIN_REASONING_EFFORT') || 'low').trim(),
    };

    try {
      const db = await this.platformSettings.getMerlinRuntimeConfig();
      const temperature =
        typeof db.temperature === 'number' && Number.isFinite(db.temperature)
          ? Math.max(0, Math.min(2, Number(db.temperature.toFixed(2))))
          : fromEnv.temperature;

      const reasoning =
        db.reasoningLevel === 'low' || db.reasoningLevel === 'high'
          ? db.reasoningLevel
          : 'medium';

      this.runtimeConfig = {
        enabled: db.enabled ?? fromEnv.enabled,
        openRouterApiKey: (db.openRouterApiKey || fromEnv.openRouterApiKey || '').trim(),
        temperature,
        reasoningLevel: reasoning,
      };
    } catch {
      this.runtimeConfig = fromEnv;
    }
  }

  private numberOf(key: string, fallback: number): number {
    const value = Number(this.config.get<string>(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private resolveUserId(user: any): Types.ObjectId | undefined {
    const raw = user?.sub ?? user?.userId ?? user?._id ?? user?.id;
    return raw && Types.ObjectId.isValid(String(raw))
      ? new Types.ObjectId(String(raw))
      : undefined;
  }

  private async resolveConversation(
    conversationId: string | undefined,
    userId: Types.ObjectId | undefined,
    visitorId: string | undefined,
    restaurantId: Types.ObjectId | undefined,
  ): Promise<MerlinConversationDocument> {
    if (conversationId && Types.ObjectId.isValid(conversationId)) {
      const existing = await this.conversationModel.findById(conversationId);
      if (existing && this.canContinue(existing, userId, visitorId)) {
        return existing;
      }
    }

    if (visitorId) {
      const owned = await this.conversationModel
        .findOne({ visitorId, userId: null })
        .sort({ updatedAt: -1 });
      if (owned) return owned;
    }

    if (userId) {
      const owned = await this.conversationModel
        .findOne({ userId })
        .sort({ updatedAt: -1 });
      if (owned) return owned;
    }

    return this.createConversation(conversationId, userId, visitorId, restaurantId);
  }

  private canContinue(
    conversation: MerlinConversationDocument,
    userId: Types.ObjectId | undefined,
    visitorId: string | undefined,
  ): boolean {
    if (conversation.userId) {
      return !!userId && conversation.userId.toString() === userId.toString();
    }
    return !!visitorId && conversation.visitorId === visitorId;
  }

  private async createConversation(
    forcedId: string | undefined,
    userId: Types.ObjectId | undefined,
    visitorId: string | undefined,
    restaurantId: Types.ObjectId | undefined,
  ): Promise<MerlinConversationDocument> {
    return this.conversationModel.create({
      ...(forcedId && Types.ObjectId.isValid(forcedId)
        ? { _id: new Types.ObjectId(forcedId) }
        : {}),
      userId,
      role: userId ? 'authenticated' : 'visitor',
      visitorId,
      visitorDate: visitorId
        ? (this.visitorDateOf(visitorId) ?? this.today())
        : undefined,
      restaurantId,
      messages: [],
    });
  }

  private describeUpstreamError(status: number, detail: string): string {
    let upstream = '';
    try {
      upstream = JSON.parse(detail)?.error?.message ?? '';
    } catch {
      upstream = detail;
    }

    if (status === 429) {
      const seconds = /try again in ([\d.]+)\s*s/i.exec(upstream)?.[1];
      const wait = seconds
        ? `${Math.ceil(Number(seconds))} seconde(s)`
        : 'un instant';
      return `Le service Merlin AI a atteint sa limite de requêtes pour le moment. Merci de réessayer dans ${wait}.`;
    }
    if (status === 401 || status === 403) {
      return "L'accès au service d'IA est refusé : la clé d'API est invalide ou expirée.";
    }
    if (status === 404) {
      return "Le modèle d'IA configuré n'est pas disponible pour cette clé d'API.";
    }
    return '';
  }

  private isSwitchableModelError(error: unknown): boolean {
    if (error instanceof MerlinUpstreamError) {
      return ![400, 401, 403, 422, 451].includes(error.status);
    }
    return true;
  }

  private async streamCompletion(
    messages: { role: string; content: string }[],
    onChunk: (text: string) => void,
  ): Promise<void> {
    const models = this.orderedModels();
    const failures: string[] = [];

    for (let index = 0; index < models.length; index++) {
      const model = models[index];
      const checkpoint = messages.length;
      let emitted = false;
      const guardedChunk = (text: string) => {
        emitted = true;
        onChunk(text);
      };

      try {
        await this.completeWithModelFallbacks(model, messages, guardedChunk);
        if (index > 0) {
          this.logger.log(
            `Merlin : réponse obtenue avec le modèle de secours « ${model} » (après ${failures.length} échec(s)).`,
          );
        }
        return;
      } catch (error) {
        messages.length = checkpoint;
        failures.push(`${model} → ${(error as Error).message.slice(0, 100)}`);

        if (emitted || index === models.length - 1 || !this.isSwitchableModelError(error)) {
          if (failures.length > 1) {
            this.logger.error(`Merlin : tous les modèles ont échoué — ${failures.join(' | ')}`);
          }
          throw error;
        }

        this.logger.warn(
          `Modèle « ${model} » indisponible (${(error as Error).message.slice(0, 100)}) : bascule vers « ${models[index + 1]} ».`,
        );
      }
    }
  }

  private async completeWithModelFallbacks(
    model: string,
    messages: { role: string; content: string }[],
    onChunk: (text: string) => void,
  ): Promise<void> {
    const effort = this.reasoningEffort;
    try {
      await this.complete(model, messages, onChunk, effort);
      return;
    } catch (error) {
      if (error instanceof MerlinUpstreamError && effort && /reasoning_effort/i.test(error.message)) {
        this.logger.warn(
          `Le modèle « ${model} » ne supporte pas reasoning_effort : nouvel essai sans ce paramètre.`,
        );
        await this.complete(model, messages, onChunk, '');
        return;
      }
      throw error;
    }
  }

  private async complete(
    model: string,
    messages: { role: string; content: string }[],
    onChunk: (text: string) => void,
    effort: string,
  ): Promise<void> {
    const abort = new AbortController();
    const timeoutMs = this.numberOf('MERLIN_TIMEOUT_MS', 90_000);
    const timer = setTimeout(() => abort.abort(), timeoutMs);

    try {
      const payload: Record<string, unknown> = {
        model,
        messages,
        stream: true,
        temperature: this.temperature,
      };
      if (effort) {
        payload.reasoning_effort = effort;
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          ...this.attributionHeaders(),
        },
        body: JSON.stringify(payload),
        signal: abort.signal,
      });

      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => '');
        throw new MerlinUpstreamError(
          `HTTP ${response.status} ${detail.slice(0, 300)}`,
          this.describeUpstreamError(response.status, detail),
          response.status,
        );
      }

      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      if (contentType && !contentType.includes('text/event-stream') && !contentType.includes('application/json')) {
        throw new MerlinUpstreamError(
          `Réponse inattendue (${contentType}) depuis « ${this.baseUrl} »`,
          "Le service d'IA est mal configuré (point d'entrée invalide).",
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data) as {
              choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
              error?: { code?: number; message?: string };
            };

            if (parsed?.error || parsed?.choices?.[0]?.finish_reason === 'error') {
              const upstream = parsed.error?.message ?? 'cause inconnue';
              const code = Number(parsed.error?.code) || 0;
              throw new MerlinUpstreamError(
                `Erreur en cours de flux : ${upstream}`,
                this.describeUpstreamError(code, JSON.stringify(parsed.error ?? {})),
                code,
              );
            }

            const text = parsed?.choices?.[0]?.delta?.content;
            if (typeof text === 'string' && text) onChunk(text);
          } catch (error) {
            if (error instanceof MerlinUpstreamError) throw error;
          }
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async ask(
    dto: AskMerlinDto,
    user: any,
  ): Promise<{ stream: ReadableStream<string>; conversationId: string }> {
    await this.refreshRuntimeConfig();
    if (!this.enabled) {
      throw new Error('Merlin est momentanément indisponible.');
    }
    if (!this.apiKey) {
      throw new Error("Merlin n'est pas encore configuré (clé d'API manquante).");
    }

    const userId = this.resolveUserId(user);
    const visitorId = userId ? undefined : dto.visitorId || undefined;
    const restaurantId = user?.restaurantId
      ? new Types.ObjectId(user.restaurantId)
      : undefined;

    const conversation = await this.resolveConversation(
      dto.conversationId,
      userId,
      visitorId,
      restaurantId,
    );

    conversation.messages.push({
      role: 'user',
      content: dto.message,
      createdAt: new Date(),
      visitorId,
    });

    const businessContext = await this.contextBuilder.build(user);

    const settings = await this.platformSettings.getPublicSettings();
    const contact = settings?.contact || {};
    const supportPhone = contact.supportPhone || '';
    const supportEmail = contact.contactEmail || '';
    const contactInfo = `\n\nCoordonnées de support Eat App :\n- Téléphone : ${supportPhone || 'Non disponible'}\n- Email : ${supportEmail || 'Non disponible'}`;

    const routesSection = this.routesResource
      ? `\n\n--- ROUTES DE LA PLATEFORME (utilise ces liens pour orienter l'utilisateur) ---\n${this.routesResource}\n--- FIN DES ROUTES ---`
      : '';

    let systemContent = `${MERLIN_SYSTEM_PROMPT}${contactInfo}${routesSection}\n\nContexte actuel :\n${businessContext}`;

    if (this.recipesResource && RECIPE_KEYWORDS.test(dto.message)) {
      systemContent += `\n\n--- BASE DE RECETTES CAMEROUNAISES (consulte cette ressource si l'utilisateur demande une recette) ---\n${this.recipesResource}\n--- FIN DES RECETTES ---`;
    }

    const systemMessage = { role: 'system', content: systemContent };
    const contextMessages = this.numberOf('MERLIN_CONTEXT_MESSAGES', 10);

    const recentMessages: { role: string; content: string }[] = conversation.messages
      .slice(-contextMessages)
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));

    const stream = new ReadableStream<string>({
      start: async (controller) => {
        let answer = '';
        try {
          await this.streamCompletion(
            [systemMessage, ...recentMessages],
            (chunk) => {
              answer += chunk;
              controller.enqueue(chunk);
            },
          );
        } catch (error) {
          this.logger.error(`Erreur de génération Merlin : ${(error as Error).message}`);
          const friendly =
            (error as MerlinUpstreamError)?.userMessage ||
            'Désolé, une erreur technique est survenue. Merci de réessayer plus tard.';
          answer = answer || friendly;
          controller.enqueue(friendly);
        }

        conversation.messages.push({
          role: 'assistant',
          content: answer.trim() || 'Je ne parviens pas à répondre pour le moment.',
          createdAt: new Date(),
          visitorId: conversation.visitorId,
        });
        await this.persist(conversation);
        controller.close();
      },
    });

    return { stream, conversationId: conversation._id.toString() };
  }

  private async persist(conversation: MerlinConversationDocument): Promise<void> {
    const maxHistory = this.numberOf('MERLIN_MAX_HISTORY', 50);
    if (conversation.messages.length > maxHistory) {
      conversation.messages = conversation.messages.slice(-maxHistory);
    }
    try {
      await conversation.save();
    } catch (error) {
      this.logger.error(
        `Enregistrement de la conversation impossible : ${(error as Error).message}`,
      );
    }
  }

  async getConversation(
    id: string,
    user: any,
    skip = 0,
    limit = 20,
  ): Promise<{ messages: { role: string; content: string; createdAt: Date }[]; total: number }> {
    if (!Types.ObjectId.isValid(id)) {
      return { messages: [], total: 0 };
    }
    const conversation = await this.conversationModel.findById(id).lean();
    if (!conversation) {
      return { messages: [], total: 0 };
    }
    const requester = this.resolveUserId(user);
    if (
      conversation.userId &&
      (!requester || conversation.userId.toString() !== requester.toString())
    ) {
      return { messages: [], total: 0 };
    }
    const all = conversation.messages || [];
    const end = all.length - skip;
    const start = Math.max(0, end - limit);
    return {
      messages: all.slice(start, end),
      total: all.length,
    };
  }

  async getLatestConversation(
    user: any,
    skip = 0,
    limit = 20,
  ): Promise<{ id: string; messages: { role: string; content: string; createdAt: Date }[]; total: number } | null> {
    const requester = this.resolveUserId(user);
    if (!requester) return null;
    const conversation = await this.conversationModel
      .findOne({ userId: requester })
      .sort({ updatedAt: -1 })
      .lean();
    if (!conversation) return null;
    const all = conversation.messages || [];
    const end = all.length - skip;
    const start = Math.max(0, end - limit);
    return {
      id: conversation._id.toString(),
      messages: all.slice(start, end),
      total: all.length,
    };
  }

  async getVisitorConversation(
    visitorId: string,
    skip = 0,
    limit = 20,
  ) {
    if (!visitorId?.trim()) return EMPTY_PAGE;

    const conversation = await this.conversationModel
      .findOne({
        visitorId: visitorId.trim(),
        userId: null,
        visitorDate: this.visitorDateOf(visitorId) ?? this.today(),
      })
      .sort({ updatedAt: -1 })
      .lean();
    if (!conversation) return EMPTY_PAGE;

    const all = (conversation as any).messages || [];
    const end = all.length - skip;
    const start = Math.max(0, end - limit);
    return {
      id: (conversation as any)._id.toString(),
      messages: all.slice(start, Math.max(0, end)),
      total: all.length,
    };
  }
}