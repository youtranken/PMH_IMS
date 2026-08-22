import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'ims:is_public';

/** Route không yêu cầu đăng nhập (health, login, callback, webhook...). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
