import { Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { FavoritesService } from './favorites.service';

@ApiTags('favorites')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  @ApiOperation({ summary: 'Lister les favoris (avec détails du plat) du client connecté' })
  list(@Req() req: any) {
    return this.favoritesService.list(req.user?.sub);
  }

  @Get('ids')
  @ApiOperation({ summary: 'Lister uniquement les identifiants des plats favoris du client connecté' })
  listIds(@Req() req: any) {
    return this.favoritesService.listIds(req.user?.sub);
  }

  @Post(':menuItemId')
  @ApiOperation({ summary: 'Ajouter un plat aux favoris' })
  add(@Req() req: any, @Param('menuItemId') menuItemId: string) {
    return this.favoritesService.add(req.user?.sub, menuItemId);
  }

  @Delete(':menuItemId')
  @ApiOperation({ summary: 'Retirer un plat des favoris' })
  remove(@Req() req: any, @Param('menuItemId') menuItemId: string) {
    return this.favoritesService.remove(req.user?.sub, menuItemId);
  }
}
