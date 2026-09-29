import { Injectable } from '@nestjs/common';
import { SystemConfigService } from '../config-sys/system-config.service';
import { evaluateSession } from './session-policy';
import { SessionService } from './session.service';

/**
 * AD-2: public api của `auth` cho module khác hỏi về PHIÊN đăng nhập.
 *
 * Chỉ trả lời "phiên còn sống không" — không trả hàng phiên, không csrf, không bản băm token.
 * Luật sống/chết là đúng `evaluateSession` mà `SessionGuard` dùng, nên hai nơi không thể lệch
 * nhau (Q-15: quyền mở két chết cùng phiên đã xin).
 */
@Injectable()
export class AuthApiService {
  constructor(
    private readonly sessions: SessionService,
    private readonly config: SystemConfigService,
  ) {}

  async isSessionAlive(id: string): Promise<boolean> {
    return (await this.aliveSessionIds([id])).has(id);
  }

  /**
   * Những id trong danh sách còn sống. Id không có trong bảng (đã bị dọn) là đã chết.
   *
   * Chết là một chiều: phiên bị thu hồi hay quá hạn không sống lại được (guard chặn trước khi
   * gia hạn idle), nên đọc kết quả này rồi mới đóng quyền không có cửa sổ tranh chấp.
   */
  async aliveSessionIds(ids: string[]): Promise<Set<string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Set();
    const [rows, idleMinutes] = await Promise.all([
      this.sessions.findMany(unique),
      this.config.getNumber('sessionIdleMinutes'),
    ]);
    const now = new Date();
    return new Set(
      rows.filter((s) => evaluateSession(s, idleMinutes, now) === 'alive').map((s) => s.id),
    );
  }
}
