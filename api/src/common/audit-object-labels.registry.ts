import { Global, Injectable, Logger, Module } from '@nestjs/common';

/**
 * Sổ đăng ký "đối tượng này tên là gì" cho màn Nhật ký.
 *
 * `audit_log` chỉ giữ `object_type` + `object_id` (UUID). "account.created → user c91a9a41…"
 * không trả lời được câu mà màn Nhật ký sinh ra để trả lời — tạo tài khoản CỦA AI, xem két
 * CỦA MÁY NÀO.
 *
 * Vì sao là sổ đăng ký: `audit` là module NỀN, `devices`/`vault`/`ipam`… là nghiệp vụ, và
 * `dependency-cruiser` chặn nền import nghiệp vụ (`base-must-not-import-biz`, AD-2). Nên chiều
 * đi ngược: `audit` ĐỌC sổ, module CHỦ SỞ HỮU bảng tự khai cách gọi tên đối tượng của mình lúc
 * khởi động — và chỉ nó đọc bảng của nó (AD-3). Cùng khuôn với `OwnerExistsRegistry`.
 *
 * Tra nhãn là việc PHỤ: loại chưa ai khai, id không phải UUID, hay một người gọi tên ném lỗi
 * thì dòng đó giữ nguyên loại + UUID như trước. Nhật ký an ninh không được tắt vì một nhãn.
 */

export interface AuditObjectLabel {
  /** Nhãn người đọc được: email tài khoản, mã thiết bị, tên secret + chủ thể… */
  label: string;
  /** Đường dẫn giao diện tới hồ sơ (vd `/devices/<id>`), nếu có. */
  path: string | null;
}

export interface AuditObjectLabeler {
  /** Những `object_type` mà module này gọi tên được. */
  readonly objectTypes: readonly string[];
  /** Một MẺ id cùng loại → nhãn. Id không còn tồn tại thì bỏ khỏi Map. */
  labelsFor(objectType: string, ids: string[]): Promise<Map<string, AuditObjectLabel>>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Khoá của Map kết quả — một id có thể trùng giữa hai loại khác nhau. */
export const auditObjectKey = (type: string, id: string): string => `${type}:${id}`;

@Injectable()
export class AuditObjectLabelRegistry {
  private readonly logger = new Logger(AuditObjectLabelRegistry.name);
  private readonly labelers: AuditObjectLabeler[] = [];

  register(labeler: AuditObjectLabeler): void {
    if (this.labelers.includes(labeler)) return;
    this.labelers.push(labeler);
  }

  /** Những loại đã có người gọi tên — để bài kiểm biết loại nào còn trơ UUID. */
  knownTypes(): string[] {
    return [...new Set(this.labelers.flatMap((l) => l.objectTypes))].sort();
  }

  /**
   * Nhãn cho cả một trang nhật ký: MỘT câu hỏi mỗi loại, không phải một câu mỗi dòng.
   * Khoá của Map là `auditObjectKey(type, id)`.
   */
  async labelsFor(
    refs: { objectType: string | null; objectId: string | null }[],
  ): Promise<Map<string, AuditObjectLabel>> {
    const byType = new Map<string, Set<string>>();
    for (const ref of refs) {
      if (!ref.objectType || !ref.objectId || !UUID_RE.test(ref.objectId)) continue;
      const ids = byType.get(ref.objectType) ?? new Set<string>();
      ids.add(ref.objectId.toLowerCase());
      byType.set(ref.objectType, ids);
    }
    const out = new Map<string, AuditObjectLabel>();
    await Promise.all(
      [...byType.entries()].map(async ([type, ids]) => {
        const labeler = this.labelers.find((l) => l.objectTypes.includes(type));
        if (!labeler) return;
        try {
          const labels = await labeler.labelsFor(type, [...ids]);
          for (const [id, label] of labels) out.set(auditObjectKey(type, id.toLowerCase()), label);
        } catch (error) {
          this.logger.warn(`Không gọi được tên đối tượng loại ${type}: ${String(error)}`);
        }
      }),
    );
    return out;
  }
}

@Global()
@Module({ providers: [AuditObjectLabelRegistry], exports: [AuditObjectLabelRegistry] })
export class AuditObjectLabelsModule {}
