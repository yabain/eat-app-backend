import { BadRequestException, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UserRole } from '../../common/enums/roles.enum';

type GoogleTokenInfo = {
  aud: string;
  sub: string;
  email: string;
  email_verified?: string | boolean;
  given_name?: string;
  family_name?: string;
  name?: string;
  picture?: string;
};

@Injectable()
export class AuthService {
  private static readonly RESET_PASSWORD_TTL_MS = 60 * 60 * 1000;

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.userModel.findOne({ email: dto.email.toLowerCase() });
    if (exists) throw new BadRequestException('Email already exists');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.userModel.create({
      ...dto,
      email: dto.email.toLowerCase(),
      passwordHash,
      role: UserRole.CLIENT,
      authProvider: 'local',
      isProfileComplete: true,
    });
    return this.buildAuthResponse(user);
  }

  async login(dto: LoginDto) {
    const user = await this.userModel
      .findOne({ email: dto.email.toLowerCase() })
      .select('+passwordHash');
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (!user.isActive) throw new UnauthorizedException('Account is disabled');
    if (!user.passwordHash) throw new UnauthorizedException('Use Google sign-in for this account');
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    return this.buildAuthResponse(user);
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.toLowerCase();
    const user = await this.userModel
      .findOne({ email, isActive: true })
      .select('+passwordResetTokenHash +passwordResetExpiresAt');

    if (!user) return { ok: true };

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + AuthService.RESET_PASSWORD_TTL_MS);

    await this.userModel.findByIdAndUpdate(user._id, {
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: expiresAt,
    });

    await this.sendResetPasswordEmail(user.email, rawToken);
    return { ok: true };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = this.hashResetToken(dto.token);
    const now = new Date();

    const user = await this.userModel
      .findOne({
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: { $gt: now },
      })
      .select('+passwordHash +passwordResetTokenHash +passwordResetExpiresAt');

    if (!user) throw new UnauthorizedException('Invalid or expired reset token');
    if (!user.isActive) throw new UnauthorizedException('Account is disabled');

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.userModel.findByIdAndUpdate(user._id, {
      passwordHash,
      $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 },
    });

    return { ok: true };
  }

  async googleLogin(dto: GoogleLoginDto) {
    const googleUser = await this.verifyGoogleIdToken(dto.idToken);
    const email = googleUser.email.toLowerCase();

    let user = await this.userModel.findOne({
      $or: [{ googleId: googleUser.sub }, { email }],
    });

    if (user && user.googleId && user.googleId !== googleUser.sub) {
      throw new BadRequestException('This email is already linked to another Google account');
    }

    if (user) {
      if (!user.isActive) throw new UnauthorizedException('Account is disabled');

      const updatePayload: Partial<User> = {};
      if (!user.googleId) updatePayload.googleId = googleUser.sub;
      if (user.authProvider !== 'google') updatePayload.authProvider = 'google';
      if (!user.profileImage && googleUser.picture) updatePayload.profileImage = googleUser.picture;

      const missingFields = this.getMissingProfileFields({
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
      });
      updatePayload.isProfileComplete = missingFields.length === 0;

      if (Object.keys(updatePayload).length > 0) {
        user = await this.userModel.findByIdAndUpdate(user._id, updatePayload, { new: true });
      }

      return this.buildAuthResponse(user);
    }

    const names = this.extractGoogleNames(googleUser);
    const userPayload = {
      email,
      googleId: googleUser.sub,
      firstName: names.firstName,
      lastName: names.lastName,
      profileImage: googleUser.picture,
      role: UserRole.CLIENT,
      authProvider: 'google',
      isProfileComplete: false,
    };
    userPayload.isProfileComplete = this.getMissingProfileFields(userPayload).length === 0;

    const created = await this.userModel.create(userPayload);
    return this.buildAuthResponse(created);
  }

  async completeProfile(currentUser: any, dto: CompleteProfileDto) {
    const user = await this.userModel.findById(currentUser.sub);
    if (!user) throw new UnauthorizedException('User not found');
    if (!user.isActive) throw new UnauthorizedException('Account is disabled');

    const payload: Partial<User> = {};
    const firstName = this.normalizeOptionalString(dto.firstName);
    const lastName = this.normalizeOptionalString(dto.lastName);
    const phone = this.normalizeOptionalString(dto.phone);
    const profileImage = this.normalizeOptionalString(dto.profileImage);

    if (firstName !== undefined) payload.firstName = firstName;
    if (lastName !== undefined) payload.lastName = lastName;
    if (phone !== undefined) payload.phone = phone;
    if (profileImage !== undefined) payload.profileImage = profileImage;

    const mergedProfile = {
      firstName: payload.firstName ?? user.firstName,
      lastName: payload.lastName ?? user.lastName,
      phone: payload.phone ?? user.phone,
    };
    const missingFields = this.getMissingProfileFields(mergedProfile);
    if (missingFields.length > 0) {
      throw new BadRequestException({
        message: 'Profile is incomplete',
        missingProfileFields: missingFields,
      });
    }

    payload.isProfileComplete = true;
    const updated = await this.userModel.findByIdAndUpdate(user._id, payload, { new: true });
    return this.buildAuthResponse(updated);
  }

  async me(user: any) {
    const currentUser = await this.userModel.findById(user.sub).select('-passwordHash');
    if (!currentUser) throw new UnauthorizedException('User not found');
    return this.buildUserResponse(currentUser);
  }

  private async verifyGoogleIdToken(idToken: string): Promise<GoogleTokenInfo> {
    const googleClientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    if (!googleClientId) throw new UnauthorizedException('Google sign-in is not configured');

    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!response.ok) throw new UnauthorizedException('Invalid Google token');

    const tokenInfo = (await response.json()) as GoogleTokenInfo;
    if (tokenInfo.aud !== googleClientId) throw new UnauthorizedException('Invalid Google audience');
    if (!tokenInfo.sub || !tokenInfo.email) throw new UnauthorizedException('Invalid Google token payload');
    if (tokenInfo.email_verified === false || tokenInfo.email_verified === 'false') {
      throw new UnauthorizedException('Google email is not verified');
    }

    return tokenInfo;
  }

  private extractGoogleNames(googleUser: GoogleTokenInfo) {
    const firstName = this.normalizeOptionalString(googleUser.given_name);
    const lastName = this.normalizeOptionalString(googleUser.family_name);
    if (firstName || lastName) return { firstName, lastName };

    const parts = this.normalizeOptionalString(googleUser.name)?.split(/\s+/) || [];
    return {
      firstName: parts[0],
      lastName: parts.length > 1 ? parts.slice(1).join(' ') : undefined,
    };
  }

  private normalizeOptionalString(value?: string) {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
  }

  private getMissingProfileFields(profile: { firstName?: string | null; lastName?: string | null; phone?: string | null }) {
    return (['firstName', 'lastName', 'phone'] as const).filter((field) => !this.normalizeOptionalString(profile[field]));
  }

  private hashResetToken(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private buildResetPasswordLink(token: string) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    if (!frontendUrl) throw new InternalServerErrorException('Reset password frontend URL is not configured');

    const resetPath = this.configService.get<string>('RESET_PASSWORD_PATH') || '/reset-password';
    const normalizedBase = frontendUrl.replace(/\/+$/, '');
    const normalizedPath = resetPath.startsWith('/') ? resetPath : `/${resetPath}`;
    return `${normalizedBase}${normalizedPath}?token=${encodeURIComponent(token)}`;
  }

  private async sendResetPasswordEmail(email: string, token: string) {
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    const smtpPort = Number(this.configService.get<string>('SMTP_PORT'));
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPass = this.configService.get<string>('SMTP_PASS');

    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
      throw new InternalServerErrorException('SMTP configuration is incomplete');
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    const resetLink = this.buildResetPasswordLink(token);
    const html = `
      <p>Bonjour,</p>
      <p>Vous avez demande la reinitialisation de votre mot de passe.</p>
      <p>Ce lien est valable 1 heure.</p>
      <p><a href="${resetLink}">Reinitialiser mon mot de passe</a></p>
      <p>Si vous n'etes pas a l'origine de cette demande, ignorez cet email.</p>
    `;

    await transporter.sendMail({
      from: smtpUser,
      to: email,
      subject: 'Reinitialisation de mot de passe',
      html,
    });
  }

  private buildAuthResponse(user: UserDocument) {
    const userResponse = this.buildUserResponse(user);
    const missingProfileFields = this.getMissingProfileFields(userResponse);
    const payload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
      restaurantId: user.restaurantId ? user.restaurantId.toString() : undefined,
    };
    return {
      accessToken: this.jwtService.sign(payload),
      user: userResponse,
      requiresProfileCompletion: missingProfileFields.length > 0,
      missingProfileFields,
    };
  }

  private buildUserResponse(user: UserDocument) {
    const missingProfileFields = this.getMissingProfileFields({
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
    });

    return {
      id: user._id.toString(),
      email: user.email,
      firstName: user.firstName || null,
      lastName: user.lastName || null,
      phone: user.phone || null,
      profileImage: user.profileImage || null,
      isActive: user.isActive,
      role: user.role,
      restaurantId: user.restaurantId ? user.restaurantId.toString() : null,
      authProvider: user.authProvider || 'local',
      isProfileComplete: missingProfileFields.length === 0,
    };
  }
}
