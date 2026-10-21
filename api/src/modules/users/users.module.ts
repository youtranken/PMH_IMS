import { Module } from '@nestjs/common';
import { UsersApiService } from './users.api';
import { UsersService } from './users.service';
import { FeatureGroupsService } from './feature-groups.service';
import { UsersAuditLabeler } from './users-audit-labeler';

/**
 * Chủ sở hữu bảng `users` + `known_device` (AD-3).
 * Ra ngoài chỉ xuất UsersApiService (AD-2); UsersService xuất riêng cho module auth —
 * auth là module cùng tầng nền và cần đọc/ghi credential, không thể đi qua api rút gọn.
 */
@Module({
  providers: [UsersService, UsersApiService, UsersAuditLabeler, FeatureGroupsService],
  exports: [UsersApiService, UsersService, FeatureGroupsService],
})
export class UsersModule {}
