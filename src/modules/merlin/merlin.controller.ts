import { Body, Controller, Get, Logger, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { AskMerlinDto } from './dto/ask-merlin.dto';
import { MerlinService } from './merlin.service';

@ApiTags('merlin')
@Controller('merlin')
export class MerlinController {
  private readonly logger = new Logger(MerlinController.name);

  constructor(private readonly merlinService: MerlinService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Post('ask')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Pose une question à Merlin (l\'assistant IA). Retourne un flux SSE.',
  })
  @ApiBody({ type: AskMerlinDto })
  async ask(@Req() req: any, @Body() dto: AskMerlinDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const write = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const { stream, conversationId } = await this.merlinService.ask(dto, req.user);
      write({ conversationId });
      const reader = stream.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          write({ done: true });
          res.end();
          return;
        }
        write({ text: value });
      }
    } catch (err: any) {
      this.logger.error('Merlin controller error', err.message);
      write({ error: 'Impossible de contacter Merlin. Réessaie plus tard.' });
      res.end();
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('conversation/:id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Récupère l\'historique d\'une conversation Merlin.' })
  async getConversation(
    @Param('id') id: string,
    @Req() req: any,
    @Query('skip') skip?: string,
    @Query('limit') limit?: string,
  ) {
    return this.merlinService.getConversation(id, req.user, Number(skip) || 0, Number(limit) || 20);
  }

  @UseGuards(JwtAuthGuard)
  @Get('conversations')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Récupère la dernière conversation Merlin de l\'utilisateur connecté.' })
  async getLatestConversation(
    @Req() req: any,
    @Query('skip') skip?: string,
    @Query('limit') limit?: string,
  ) {
    return this.merlinService.getLatestConversation(req.user, Number(skip) || 0, Number(limit) || 20);
  }
}
