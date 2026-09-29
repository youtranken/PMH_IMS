import { SetMetadata } from '@nestjs/common';

export const AUDITED_KEY = 'ims:audited';

export interface AuditedOptions {
  /**
   * `true` = SERVICE đã tự ghi audit trong transaction nghiệp vụ (AD-5), interceptor
   * KHÔNG ghi thêm nữa.
   *
   * Vì sao cần cờ này: route vừa có `@Audited` vừa gọi `audit.appendWithin` trong service
   * thì MỖI thao tác đẻ ra HAI dòng audit — một dòng chi tiết (đổi trường nào, giá trị
   * cũ/mới) và một dòng chung chung chỉ có method + path, đôi khi còn khác tên hành động
   * (`device.status.changed` và `device.status-changed`). Màn nhật ký đọc bảng đó thì thấy
   * mọi việc lặp đôi, không biết tin dòng nào.
   *
   * Vẫn giữ `@Audited` trên route (thay vì bỏ hẳn) vì AD-9 đòi mỗi endpoint ghi phải KHAI
   * BÁO mình được audit — nhìn controller là biết, không phải lần vào service mới rõ.
   */
  writtenByService?: boolean;
}

export interface AuditedMeta extends AuditedOptions {
  /** Mã interceptor ghi (mã đầu tiên khi khai nhiều mã). */
  action: string;
  /** Mọi mã route này có thể để lại trong `audit_log`. */
  actions: readonly string[];
  objectType?: string;
}

/**
 * Đánh dấu route auditable (AD-9).
 *
 * - Mặc định: handler thành công → AuditInterceptor tự ghi một dòng audit.
 * - `{ writtenByService: true }`: service tự ghi (chi tiết hơn, và ghi TRONG transaction
 *   nghiệp vụ nên rollback là mất luôn vết — đúng ý AD-5). Interceptor đứng ngoài.
 */
export const Audited = (
  /**
   * Nhiều mã khi service chọn mã theo dữ liệu (vd khoá / vô hiệu hoá / mở khoá tài khoản): khai
   * ĐỦ các mã thật thay vì một tên chung không bao giờ xuất hiện trong nhật ký.
   */
  action: string | readonly string[],
  objectType?: string,
  options: AuditedOptions = {},
) => {
  const actions = typeof action === 'string' ? [action] : [...action];
  if (actions.length === 0 || (actions.length > 1 && !options.writtenByService)) {
    throw new Error(
      '@Audited nhiều mã chỉ dùng kèm { writtenByService: true } — interceptor chỉ ghi được một mã.',
    );
  }
  return SetMetadata(AUDITED_KEY, {
    action: actions[0],
    actions,
    objectType,
    ...options,
  } satisfies AuditedMeta);
};
