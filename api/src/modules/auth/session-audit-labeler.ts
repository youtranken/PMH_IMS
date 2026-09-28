import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  AuditObjectLabelRegistry,
  type AuditObjectLabel,
  type AuditObjectLabeler,
} from '../../common/audit-object-labels.registry';
import { UI_PATHS } from '../../common/ui-paths';
import { UsersApiService } from '../users/users.api';
import { SessionService } from './session.service';

/**
 * Đối tượng `session` (SA đóng phiên, tự đăng xuất máy khác) gọi bằng email người sở hữu
 * phiên: UUID của phiên không nói gì, còn "phiên của ai" là câu người rà nhật ký cần.
 */
@Injectable()
export class SessionAuditLabeler implements AuditObjectLabeler, OnModuleInit {
  readonly objectTypes = ['session'] as const;

  constructor(
    private readonly registry: AuditObjectLabelRegistry,
    private readonly sessions: SessionService,
    private readonly users: UsersApiService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async labelsFor(_type: string, ids: string[]): Promise<Map<string, AuditObjectLabel>> {
    const owners = await this.sessions.ownersOf(ids);
    const emails = await this.users.emailsByIds([...new Set(owners.values())]);
    const out = new Map<string, AuditObjectLabel>();
    for (const [sessionId, userId] of owners) {
      const email = emails.get(userId);
      if (email) out.set(sessionId, { label: email, path: UI_PATHS.account(email) });
    }
    return out;
  }
}
