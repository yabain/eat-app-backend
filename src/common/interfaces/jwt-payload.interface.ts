import { UserRole } from '../enums/roles.enum';
export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  restaurantId?: string;
  rtv?: number;
  jti?: string;
}
