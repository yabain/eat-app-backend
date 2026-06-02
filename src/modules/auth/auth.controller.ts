import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
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

  @Post('register')
  @ApiOperation({ summary: 'Inscription utilisateur' })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({
    description: 'Utilisateur créé. JWT valable 90 jours retourné dans accessToken.',
    type: AuthResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Email déjà utilisé ou données invalides' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Connexion utilisateur' })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({
    description: 'Connexion réussie. JWT valable 90 jours retourné dans accessToken.',
    type: AuthResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Identifiants invalides, compte désactivé ou compte Google sans mot de passe local' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Déconnexion',
    description: 'Révoque le JWT courant en l’ajoutant à la liste noire serveur.',
  })
  @ApiOkResponse({ description: 'Déconnecté', type: OkResponseDto })
  async logout(@Req() req: any) {
    await this.authService.logout(this.extractBearerToken(req));
    return { ok: true };
  }

  @Post('forgot-password')
  @ApiOperation({
    summary: 'Demander un lien de réinitialisation de mot de passe',
    description: "Envoie un email de réinitialisation si l'email existe.",
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiOkResponse({
    description: 'Requête traitée',
    type: OkResponseDto,
  })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Réinitialiser le mot de passe avec un token' })
  @ApiBody({ type: ResetPasswordDto })
  @ApiOkResponse({
    description: 'Mot de passe réinitialisé',
    type: OkResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Token de réinitialisation invalide ou expiré' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('google')
  @ApiOperation({
    summary: 'Connexion ou inscription avec Google',
    description:
      "Le client envoie le ID token Google. Si l'email n'existe pas encore, un compte client est créé. La réponse indique si le profil doit être complété et retourne un JWT valable 90 jours.",
  })
  @ApiBody({ type: GoogleLoginDto })
  @ApiOkResponse({
    description: 'Connexion Google réussie',
    type: AuthResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Email déjà lié à un autre compte Google' })
  @ApiUnauthorizedResponse({ description: 'Token Google invalide, email Google non vérifié, audience invalide ou Google non configuré' })
  async googleLogin(@Body() dto: GoogleLoginDto) {
    return this.authService.googleLogin(dto);
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
  async completeProfile(@Req() req: any, @Body() dto: CompleteProfileDto) {
    return this.authService.completeProfile(req.user, dto);
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

  private extractBearerToken(req: any): string | undefined {
    const authHeader = String(req?.headers?.authorization || '');
    if (!authHeader.startsWith('Bearer ')) return undefined;
    return authHeader.slice('Bearer '.length).trim() || undefined;
  }
}
