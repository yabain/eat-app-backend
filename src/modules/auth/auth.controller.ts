import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { AuthResponseDto, AuthUserResponseDto } from './dto/auth-response.dto';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { OkResponseDto } from '../../common/dto/response.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private isCrossSiteProd(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  private setRefreshCookie(res: Response, refreshToken: string) {
    const crossSite = this.isCrossSiteProd();
    res.cookie(AuthService.REFRESH_TOKEN_COOKIE, refreshToken, {
      httpOnly: true,
      secure: crossSite,
      sameSite: crossSite ? 'none' : 'lax',
      path: '/api/auth',
      maxAge: AuthService.REFRESH_TOKEN_EXPIRES_MS,
    });
  }

  private clearRefreshCookie(res: Response) {
    const crossSite = this.isCrossSiteProd();
    res.clearCookie(AuthService.REFRESH_TOKEN_COOKIE, {
      httpOnly: true,
      secure: crossSite,
      sameSite: crossSite ? 'none' : 'lax',
      path: '/api/auth',
    });
  }

  private respondWithAuth(result: any, res: Response) {
    // Pose le refresh_token en cookie httpOnly, retire-le du body retourné au client.
    if (result?.refreshToken) {
      this.setRefreshCookie(res, result.refreshToken);
    }
    const { refreshToken, ...rest } = result || {};
    return rest;
  }

  @Post('register')
  @ApiOperation({ summary: 'Inscription utilisateur' })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({
    description: 'Utilisateur créé. Refresh token posé en cookie httpOnly (path=/api/auth).',
    type: AuthResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Email déjà utilisé ou données invalides' })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    return this.respondWithAuth(await this.authService.register(dto), res);
  }

  @Post('login')
  @ApiOperation({ summary: 'Connexion utilisateur' })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({
    description: 'Connexion réussie. Refresh token posé en cookie httpOnly (path=/api/auth).',
    type: AuthResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Identifiants invalides, compte désactivé ou compte Google sans mot de passe local' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.respondWithAuth(await this.authService.login(dto), res);
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Rafraîchir le access token',
    description:
      'Lit le refresh token depuis le cookie httpOnly `refresh_token`, le vérifie, et émet une nouvelle paire (rotation). Le nouveau refresh token est reposé en cookie.',
  })
  @ApiOkResponse({ description: 'Nouveau access token émis', type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Refresh token absent, invalide ou expiré' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookieToken = req.cookies?.[AuthService.REFRESH_TOKEN_COOKIE];
    try {
      return this.respondWithAuth(await this.authService.refresh(cookieToken), res);
    } catch (err) {
      this.clearRefreshCookie(res);
      throw err;
    }
  }

  @Post('logout')
  @ApiOperation({ summary: 'Déconnexion (efface le cookie de refresh)' })
  @ApiOkResponse({ description: 'Déconnecté', type: OkResponseDto })
  logout(@Res({ passthrough: true }) res: Response) {
    this.clearRefreshCookie(res);
    return { ok: true };
  }

  @Post('forgot-password')
  @ApiOperation({
    summary: 'Demander un lien de reinitialisation de mot de passe',
    description: "Envoie un email de reinitialisation si l'email existe.",
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiOkResponse({
    description: 'Requete traitee',
    type: OkResponseDto,
  })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Reinitialiser le mot de passe avec un token' })
  @ApiBody({ type: ResetPasswordDto })
  @ApiOkResponse({
    description: 'Mot de passe reinitialise',
    type: OkResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Token de reinitialisation invalide ou expire' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('google')
  @ApiOperation({
    summary: 'Connexion ou inscription avec Google',
    description:
      "Le client envoie le ID token Google. Si l'email n'existe pas encore, un compte client est créé. La réponse indique si le profil doit être complété. Le refresh token est posé en cookie httpOnly.",
  })
  @ApiBody({ type: GoogleLoginDto })
  @ApiOkResponse({
    description: 'Connexion Google réussie',
    type: AuthResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Email déjà lié à un autre compte Google' })
  @ApiUnauthorizedResponse({ description: 'Token Google invalide, email Google non vérifié, audience invalide ou Google non configuré' })
  async googleLogin(@Body() dto: GoogleLoginDto, @Res({ passthrough: true }) res: Response) {
    return this.respondWithAuth(await this.authService.googleLogin(dto), res);
  }

  @UseGuards(JwtAuthGuard)
  @Post('complete-profile')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Compléter le profil après inscription Google',
    description:
      "À appeler après /auth/google lorsque requiresProfileCompletion vaut true. Les champs requis pour finaliser le profil sont firstName, lastName et phone.",
  })
  @ApiBody({ type: CompleteProfileDto })
  @ApiOkResponse({
    description: 'Profil complété',
    type: AuthResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Profil encore incomplet',
    schema: {
      example: {
        message: 'Profile is incomplete',
        missingProfileFields: ['phone'],
        error: 'Bad Request',
        statusCode: 400,
      },
    },
  })
  async completeProfile(@Req() req: any, @Body() dto: CompleteProfileDto, @Res({ passthrough: true }) res: Response) {
    return this.respondWithAuth(await this.authService.completeProfile(req.user, dto), res);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Profil courant' })
  @ApiOkResponse({ description: 'Utilisateur connecté', type: AuthUserResponseDto })
  @ApiUnauthorizedResponse({ description: 'Token absent, invalide, expiré ou compte désactivé' })
  me(@Req() req: any) {
    return this.authService.me(req.user);
  }
}
