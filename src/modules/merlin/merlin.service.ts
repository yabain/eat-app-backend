import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import OpenAI from 'openai';
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

@Injectable()
export class MerlinService implements OnModuleInit {
  private readonly logger = new Logger(MerlinService.name);
  private readonly openai: OpenAI;
  private readonly modelName: string;
  private recipesResource = '';
  private routesResource = '';

  constructor(
    @InjectModel(MerlinConversation.name)
    private conversationModel: Model<MerlinConversationDocument>,
    private config: ConfigService,
    private contextBuilder: ContextBuilder,
    private platformSettings: PlatformSettingsService,
  ) {
    this.openai = new OpenAI({
      baseURL: 'https://api.groq.com/openai/v1',
      apiKey: config.get<string>('GROQ_API_KEY'),
    });
    this.modelName = config.get<string>('MERLIN_MODEL') || 'gemma2-9b-it';
  }

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
  }

  async ask(
    dto: AskMerlinDto,
    user: any,
  ): Promise<{ stream: ReadableStream<string>; conversationId: string }> {
    const role = user?.role || 'visitor';
    const userId = user?.sub ? new Types.ObjectId(user.sub) : undefined;
    const restaurantId = user?.restaurantId
      ? new Types.ObjectId(user.restaurantId)
      : undefined;

    let conversation: MerlinConversationDocument;
    if (dto.conversationId && Types.ObjectId.isValid(dto.conversationId)) {
      conversation = await this.conversationModel.findById(dto.conversationId);
      if (!conversation) {
        conversation = await this.conversationModel.create({
          _id: new Types.ObjectId(dto.conversationId),
          userId,
          role,
          restaurantId,
          messages: [],
        });
      }
    } else {
      conversation = await this.conversationModel.create({
        userId,
        role,
        restaurantId,
        messages: [],
      });
    }

    conversation.messages.push({
      role: 'user',
      content: dto.message,
      createdAt: new Date(),
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

    const systemMessage: OpenAI.Chat.ChatCompletionMessageParam = {
      role: 'system',
      content: systemContent,
    };

    const recentMessages: OpenAI.Chat.ChatCompletionMessageParam[] = conversation.messages
      .slice(-10)
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));

    const stream = new ReadableStream<string>({
      start: async (controller) => {
        try {
          const response = await this.openai.chat.completions.create({
            model: this.modelName,
            messages: [systemMessage, ...recentMessages],
            stream: true,
            temperature: 0.7,
          });

          let fullResponse = '';
          for await (const chunk of response) {
            const text = chunk.choices?.[0]?.delta?.content || '';
            if (text) {
              fullResponse += text;
              controller.enqueue(text);
            }
          }

          conversation.messages.push({
            role: 'assistant',
            content: fullResponse,
            createdAt: new Date(),
          });
          if (conversation.messages.length > 50) {
            conversation.messages = conversation.messages.slice(-50);
          }
          await conversation.save();

          controller.close();
        } catch (err: any) {
          this.logger.error('Merlin streaming error', err.message);
          const fallback = err.message?.includes('429') || err.message?.includes('quota')
            ? 'Désolé, le service Merlin AI est momentanément indisponible (trop de requêtes). Réessaie dans quelques minutes. 🧙'
            : 'Désolé, une erreur est survenue. Réessaie plus tard. 🧙';

          try {
            conversation.messages.push({
              role: 'assistant',
              content: fallback,
              createdAt: new Date(),
            });
            await conversation.save();
          } catch {}

          controller.enqueue(fallback);
          controller.close();
        }
      },
    });

    return { stream, conversationId: conversation._id.toString() };
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
    if (conversation.userId && user?.sub && conversation.userId.toString() !== user.sub) {
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
    if (!user?.sub) return null;
    const conversation = await this.conversationModel
      .findOne({ userId: new Types.ObjectId(user.sub) })
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
}
