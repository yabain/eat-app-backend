import { Body, Controller, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateProspectDto } from './dto/prospect.dto';
import { ProspectsService } from './prospects.service';

@ApiTags('prospects')
@Controller('prospects')
export class ProspectsPublicController {
  constructor(private readonly prospectsService: ProspectsService) {}

  @Post('subscribe')
  @ApiOperation({ summary: 'Inscription publique à la boîte aux lettres Eat' })
  @ApiBody({ type: CreateProspectDto })
  @ApiOkResponse({ description: 'Prospect inscrit' })
  subscribe(@Body() dto: CreateProspectDto) {
    return this.prospectsService.create(dto);
  }
}
