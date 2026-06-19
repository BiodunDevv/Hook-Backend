import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '@common/interfaces';

export const CurrentUser = createParamDecorator(
  (key: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: JwtPayload = request.user;
    return key ? user?.[key] : user;
  },
);
