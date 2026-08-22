/**
 * AD-7: engine expiry KHÔNG quét bảng của ai. Module nghiệp vụ đăng ký provider,
 * engine chỉ gọi provider + áp luật digest + đẩy mail qua outbox.
 *
 * Module chủ (software, ipam, sheets…) implement interface này và đăng ký ở module của mình;
 * engine chỉ biết interface, không biết bảng. Vault KHÔNG đăng ký gì (AD-4).
 */
export interface ExpiryItem {
  id: string;
  label: string;
  /** Loại để luật digest lọc: 'license' | 'ssl' | 'domain' | 'isp' | 'warranty' | 'maintenance'... */
  kind: string;
  start: string | null;
  end: string;
  /** Đường dẫn UI để email/màn Expiry trỏ về đúng hồ sơ. */
  link: string;
}

export interface ExpirySource {
  /** Tên nguồn, trùng với `kind` cha để luật digest cấu hình được. */
  readonly sourceKind: string;
  /** Trả các bản ghi có `end` nằm trong [from, to]. Engine tự quyết cửa sổ. */
  findExpiring(from: Date, to: Date): Promise<ExpiryItem[]>;
}

export const EXPIRY_SOURCES = 'EXPIRY_SOURCES';
