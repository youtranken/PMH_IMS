import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  AuditObjectLabelRegistry,
  type AuditObjectLabel,
  type AuditObjectLabeler,
} from '../../common/audit-object-labels.registry';
import { UI_PATHS } from '../../common/ui-paths';
import { UsersService } from './users.service';

/** `users` gọi tên đối tượng `user` trên màn Nhật ký bằng email — vừa tìm được vừa không đổi. */
@Injectable()
export class UsersAuditLabeler implements AuditObjectLabeler, OnModuleInit {
  readonly objectTypes = ['user'] as const;

  constructor(
    private readonly registry: AuditObjectLabelRegistry,
    private readonly users: UsersService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async labelsFor(_type: string, ids: string[]): Promise<Map<string, AuditObjectLabel>> {
    const emails = await this.users.emailsByIds(ids);
    return new Map(
      [...emails].map(([id, email]) => [id, { label: email, path: UI_PATHS.account(email) }]),
    );
  }
}
