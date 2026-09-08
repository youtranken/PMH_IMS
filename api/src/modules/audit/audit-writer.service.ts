import { Inject, Injectable, Logger } from '@nestjs/common';
import { currentRequestIp } from '../../common/request-context';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { auditLogTable } from './audit.schema';

export interface AuditEntry {
  /** user `sub` hoặc 'system' */
  actor: string;
  action: string;
  objectType?: string;
  objectId?: string;
  /**
   * Bỏ trống = lấy IP của request đang chạy (`RequestContext`), và đó là điều nên làm.
   * Chỉ khai tường minh khi dòng này nói về một IP KHÁC với IP của request hiện tại.
   */
  ip?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Writer audit tối giản (story 1.2) — CHỈ INSERT (AD-10).
 * Story 1.4 xây interceptor declarative TRÊN writer này, không thay thế.
 *
 * ===== BA HÀM, VÀ VÌ SAO PHẢI PHÂN BIỆT =====
 *
 * Rà soát 07/09 (#4) chỉ ra `append()` cũ bọc `try/catch` chỉ log rồi đi tiếp, và mọi nơi
 * dùng chung một hàm đó — kể cả `vault.reveal()`. Controller két khai `writtenByService: true`
 * nên interceptor đứng ngoài, tức `append()` là writer DUY NHẤT của đường mở két. INSERT hỏng
 * thì plaintext vẫn trả về cho người gọi và dấu vết chỉ còn một dòng log container, trong khi
 * chú thích ngay trên nó hứa "ghi TRƯỚC khi trả giá trị".
 *
 * Ranh giới đúng không phải "audit có quan trọng không" (luôn quan trọng), mà là **dòng audit
 * nằm TRƯỚC hay SAU cái nó ghi lại**:
 *
 *   `append`        — ghi TRƯỚC tác động (mở két, tải file). Ném lỗi thì tác động KHÔNG xảy
 *                     ra, không có trạng thái dở dang. Phải ném.
 *   `appendWithin`  — ghi CÙNG transaction với tác động (AD-5). Ném lỗi thì cả hai cùng
 *                     rollback. Phải ném.
 *   `appendBestEffort` — ghi SAU một tác động ĐÃ COMMIT (interceptor `@Audited`). Ném lỗi ở
 *                     đây biến một thao tác đã thành công thành 500; người dùng bấm lại và
 *                     tạo bản ghi trùng. Đó là hỏng DỮ LIỆU để cứu NHẬT KÝ — đắt hơn.
 *
 * Nghĩa là `appendBestEffort` chỉ đúng cho ĐÚNG MỘT nơi gọi: `audit.interceptor.ts`. Cần audit
 * cho một đường ghi mới thì đường đúng là `appendWithin` trong transaction nghiệp vụ, kèm
 * `@Audited(..., { writtenByService: true })` để interceptor không ghi dòng thứ hai.
 */
@Injectable()
export class AuditWriterService {
  private readonly logger = new Logger(AuditWriterService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  /**
   * Ghi một dòng, NGOÀI transaction nghiệp vụ — dành cho dòng ghi TRƯỚC tác động của nó.
   * Lỗi NÉM RA: mở được két mà mất vết thì đúng thứ két sắt sinh ra để chống.
   */
  async append(entry: AuditEntry): Promise<void> {
    await this.db.insert(auditLogTable).values(toRow(entry));
  }

  /**
   * Ghi audit TRONG transaction nghiệp vụ (review 2.1) — lỗi NÉM RA để rollback
   * cả mutation: với sổ tài sản, "đổi được nhưng mất vết" tệ hơn "đổi thất bại".
   */
  async appendWithin(tx: Pick<Database, 'insert'>, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLogTable).values(toRow(entry));
  }

  /**
   * CHỈ dành cho `AuditInterceptor`. Xem khối chú thích của lớp trước khi thêm nơi gọi thứ hai.
   */
  async appendBestEffort(entry: AuditEntry): Promise<void> {
    try {
      await this.append(entry);
    } catch (error) {
      this.logger.error(`Ghi audit thất bại (${entry.action}): ${(error as Error).message}`);
    }
  }
}

function toRow(entry: AuditEntry) {
  return {
    actor: entry.actor,
    action: entry.action,
    objectType: entry.objectType ?? null,
    objectId: entry.objectId ?? null,
    // `?? null` sau khi so `undefined`: khai `ip: null` tường minh là "dòng này không có IP",
    // khác hẳn với "không khai" — không được rơi ngược về ngữ cảnh.
    ip: entry.ip !== undefined ? entry.ip : currentRequestIp(),
    detail: entry.detail ?? null,
  };
}
