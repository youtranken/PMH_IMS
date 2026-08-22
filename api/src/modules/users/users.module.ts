import { Module } from '@nestjs/common';
import { UsersApiService } from './users.api';
import { UsersService } from './users.service';

/**
 * Chủ sở hữu bảng `users` + `known_device` (AD-3).
 * Ra ngoài chỉ xuất UsersApiService (AD-2); UsersService xuất riêng cho module auth —
 * auth là module cùng tầng nền và cần đọc/ghi credential, không thể đi qua api rút gọn.
 */
@Module({
  providers: [UsersService, UsersApiService],
  exports: [UsersApiService, UsersService],
})
export class UsersModule {}
