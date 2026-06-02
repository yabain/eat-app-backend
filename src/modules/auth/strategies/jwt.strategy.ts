import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { PassportStrategy } from '@nestjs/passport';
import { Model } from 'mongoose';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../../../common/interfaces/jwt-payload.interface';
import { RevokedToken, RevokedTokenDocument } from '../../../database/schemas/revoked-token.schema';
import { User, UserDocument } from '../../../database/schemas/user.schema';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(RevokedToken.name) private revokedTokenModel: Model<RevokedTokenDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get<string>('JWT_SECRET'),
      ignoreExpiration: false,
      passReqToCallback: true,
    });
  }
  async validate(req: any, payload: JwtPayload) {
    const token = this.extractBearerToken(req);
    if (token) {
      const revoked = await this.revokedTokenModel.exists({ token });
      if (revoked) throw new UnauthorizedException('Token revoked');
    }

    const user = await this.userModel.findById(payload.sub).select('isActive refreshTokenVersion');
    if (!user || !user.isActive) throw new UnauthorizedException('Account is disabled');
    if ((payload.rtv ?? 0) !== (user.refreshTokenVersion ?? 0)) {
      throw new UnauthorizedException('Token revoked');
    }
    return payload;
  }

  private extractBearerToken(req: any): string | undefined {
    const authHeader = String(req?.headers?.authorization || '');
    if (!authHeader.startsWith('Bearer ')) return undefined;
    return authHeader.slice('Bearer '.length).trim() || undefined;
  }
}
