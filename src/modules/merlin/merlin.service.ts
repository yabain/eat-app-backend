import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Model, Types } from 'mongoose';
import {
  MerlinConversation,
  MerlinConversationDocument,
} from '../../database/schemas/merlin-conversation.schema';
import { AskMerlinDto } from './dto/ask-merlin.dto';
import { ContextBuilder } from './prompts/context.builder';
import { MERLIN_SYSTEM_PROMPT } from './prompts/system.prompt';

@Injectable()
export class MerlinService {
  private readonly logger = new Logger(MerlinService.name);
  private readonly genAI: GoogleGenerativeAI;
  private readonly modelName: string;

  constructor(
    @InjectModel(MerlinConversation.name)
    private conversationModel: Model<MerlinConversationDocument>,
    private config: ConfigService,
    private contextBuilder: ContextBuilder,
  ) {
    this.genAI = new GoogleGenerativeAI(config.get<string>('GEMINI_API_KEY'));
    this.modelName = config.get<string>('MERLIN_MODEL') || 'gemini-2.0-flash-lite';
  }

  async ask(
    dto: AskMerlinDto,
    user: any,
  ): Promise<ReadableStream<string>> {
    const role = user?.role || 'visitor';
    const userId = user?.sub ? new Types.ObjectId(user.sub) : undefined;
    const restaurantId = user?.restaurantId
      ? new Types.ObjectId(user.restaurantId)
      : undefined;

    // Récupérer ou créer la conversation
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

    // Ajouter le message utilisateur immédiatement
    conversation.messages.push({
      role: 'user',
      content: dto.message,
      createdAt: new Date(),
    });

    // Préparer l'historique pour Gemini (sans le dernier message utilisateur)
    const history = conversation.messages.slice(-11, -1).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    // Contexte métier
    const businessContext = await this.contextBuilder.build(user);

    // Créer le ReadableStream SSE
    const stream = new ReadableStream<string>({
      start: async (controller) => {
        try {
          const model = this.genAI.getGenerativeModel({ model: this.modelName });
          const chat = model.startChat({
            history,
            systemInstruction: {
              role: 'user',
              parts: [{ text: `${MERLIN_SYSTEM_PROMPT}\n\nContexte actuel :\n${businessContext}` }],
            },
          });

          const result = await chat.sendMessageStream(dto.message);
          let fullResponse = '';

          for await (const chunk of result.stream) {
            const text = chunk.text();
            if (text) {
              fullResponse += text;
              controller.enqueue(text);
            }
          }

          // Sauvegarder la réponse
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

          // Sauvegarder quand même le message avec un fallback
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

    return stream;
  }
}
