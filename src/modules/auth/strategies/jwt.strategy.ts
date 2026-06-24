import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@modules/users/entities/user.entity';
import { JwtPayload } from '@common/interfaces';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET')!,
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const user = await this.userRepo.findOne({
      where: { id: payload.sub },
      select: {
  id: true,
  role: true,
  isActive: true
},
    });
    if (!user || user.isActive === false) {
      throw new UnauthorizedException('User not found or deactivated');
    }
    return {
      sub: user.id,
      email: payload.email,
      role: user.role,
    };
  }
}
