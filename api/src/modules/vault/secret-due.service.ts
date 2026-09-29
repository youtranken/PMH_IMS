import { Injectable } from '@nestjs/common';
import { SystemConfigService } from '../config-sys/system-config.service';
import { valueAge } from './secret-age';
import { VaultService, type SecretOwnerType } from './vault.service';

export interface OwnerSecretDue {
  ownerId: string;
  /** Mốc đổi giá trị CŨ NHẤT trong các ngăn còn sống của hồ sơ. */
  valueChangedAt: Date;
  /** Số ngày còn tới hạn đổi (`dashboard.secret_stale_days`); âm = đã quá bấy nhiêu ngày. */
  dueInDays: number;
}

/**
 * Hạn đổi mật khẩu theo từng HỒ SƠ (Q-15) — cột "Đổi lần cuối" ở danh sách tài khoản dịch vụ.
 *
 * Tách khỏi `VaultOwnersService`: file đó bị `vault-surface.spec.ts` canh không được chạm tới
 * nội dung ngăn két. Ở đây cũng chỉ có id hồ sơ + mốc thời gian, không nhãn, không loại ngăn.
 * Hạn tính bằng đúng `valueAge` mà danh sách ngăn và bảng điều khiển dùng, nên ba nơi không
 * thể nói lệch nhau.
 */
@Injectable()
export class SecretDueService {
  constructor(
    private readonly vault: VaultService,
    private readonly config: SystemConfigService,
  ) {}

  async byOwner(ownerType: SecretOwnerType): Promise<OwnerSecretDue[]> {
    const [rows, staleDays] = await Promise.all([
      this.vault.oldestValueChangeByOwner(ownerType),
      this.config.getNumber('dashboardSecretStaleDays'),
    ]);
    const now = new Date();
    return rows.map((row) => ({
      ...row,
      dueInDays: valueAge(row.valueChangedAt, staleDays, now).dueInDays,
    }));
  }
}
