import { Injectable } from '@nestjs/common';
import { SecurityProbeService } from './security-probe.service';

/**
 * AD-2: cửa chính của module `audit` cho những thứ KHÔNG phải "ghi một dòng".
 *
 * ===== VÌ SAO KHÔNG THÊM MỘT DÒNG VÀO `INFRA_PRIMITIVES` =====
 *
 * `audit/audited.decorator` và `audit/audit-writer.service` là ngoại lệ TOÀN CỤC trong
 * `ad2-boundary.js` — mở cửa cho mọi module, mãi mãi — và chính file đó đã một lần phải dọn
 * ba dòng ra khỏi danh sách vì chúng không đạt tiêu chuẩn "dùng ở khắp nơi". `SecurityProbe`
 * có đúng HAI nơi gọi (`vault`, `auth`). Thêm nó vào danh sách đóng ấy là mở cửa cho mười một
 * module để hai module đi qua — sai HÌNH DẠNG, không phải sai mức độ.
 *
 * Nên nó đi qua cửa chính, đúng khuôn `devices.api.ts` / `users.api.ts`. Module thứ ba muốn
 * dùng thì thấy ngay ở đây có gì, chứ không phải đọc một regex trong file cấu hình lint.
 */
@Injectable()
export class AuditApiService {
  constructor(private readonly probe: SecurityProbeService) {}

  /**
   * "Người này vừa thất bại một lượt quanh két" — gọi NGAY SAU khi dòng vết đã ghi.
   *
   * Không nhận số đếm từ nơi gọi: bộ đếm tự đọc lại `audit_log`, nên thêm một cửa thất bại mới
   * chỉ là thêm một `action` vào `PROBE_ACTIONS`, không phải sửa nơi gọi. Không bao giờ ném —
   * đây là tầng CẢNH BÁO, và nó không được phép làm hỏng tầng CHẶN đang gọi nó.
   */
  noteSecurityFailure(actor: string): Promise<void> {
    return this.probe.noteFailure(actor);
  }
}
