import type { TFunction } from 'i18next';

export type FieldChanges = Record<string, { before: unknown; after: unknown }> | null;

/**
 * MÔ TẢ MỘT LƯỢT SỬA CHO PANEL LỊCH SỬ — MỘT bản cho cả sáu màn (AD-15, F-09).
 *
 * ===== VÌ SAO NÓ RA ĐỜI MUỘN, VÀ CÁI GIÁ ĐÃ TRẢ =====
 *
 * Hàm này từng được CHÉP sáu lần: `device` · `ip` · `isp` · `nat` · `service-account` ·
 * `software`. Sáu bản bắt đầu giống nhau, rồi trôi: đếm 22/09 thì BA bản có nhánh
 *
 *     if (field.endsWith('Id')) return t('history.changedOnly', { field: label });
 *
 * và BA bản không. Nhánh ấy có lý do rất cụ thể — giá trị của trường `*Id` là UUID, và UUID
 * trên màn lịch sử không nói gì với ai. Nên cùng một thao tác "sửa site" cho ra hai màn hình
 * khác hẳn: tab Đường truyền nói *"đổi Site"*, tab Sổ NAT in nguyên
 * `a3f1c8e2-… → 7b9d4f10-…`.
 *
 * Không lỗi nào báo, không cổng nào đỏ — sáu bản đều tự nhất quán với chính nó. Đó là toàn bộ
 * cơ chế của mẫu "bản sao trôi": mỗi bản đúng, tập hợp thì sai, và chỉ lộ ra khi có ai đó
 * đứng cạnh hai tab cùng lúc.
 *
 * ===== PHẦN NÀO CHUNG, PHẦN NÀO RIÊNG =====
 *
 * Chung — và vì thế nằm ở đây: bỏ qua khi không có thay đổi; ô rỗng đọc là "trống"; trường
 * `*Id` chỉ nói "đã đổi"; ghép các phần bằng `; `.
 *
 * Riêng của từng màn: NHÃN của trường, và cách đọc vài giá trị đặc thù (`enabled` của NAT là
 * boolean, `status` của đường truyền là một mã). Hai thứ đó truyền vào qua `label` và
 * `display` — mở rộng bản dùng chung bằng tham số, KHÔNG fork một bản riêng.
 */
export function describeFieldChanges(
  changes: FieldChanges,
  t: TFunction,
  options: {
    /** Nhãn tiếng Việt của một trường. Không biết thì trả chính tên trường. */
    label: (field: string) => string;
    /**
     * Cách đọc một GIÁ TRỊ của màn này. Trả `undefined` = dùng cách đọc mặc định.
     *
     * Không nhận `null` làm "dùng mặc định": `null` là một giá trị THẬT mà hàm này phải đọc
     * được ("trống"), nên lấy nó làm cờ điều khiển thì hai ý nghĩa chồng lên nhau.
     */
    display?: (field: string, value: unknown) => string | undefined;
    /**
     * Trường không đổi (`before === after`) thì vẽ như bối cảnh thay vì "A → A".
     *
     * Chỉ sổ NAT cần: nó đính kèm `ports` vào dòng "Gỡ rule" để người đọc biết đang nói về
     * port nào. Các màn khác không gửi trường không đổi, nên bật mặc định là vẽ thừa.
     */
    unchangedAsContext?: boolean;
  },
): string | null {
  if (!changes) return null;

  const read = (field: string, value: unknown): string => {
    const custom = options.display?.(field, value);
    if (custom !== undefined) return custom;
    if (value === null || value === undefined || value === '') return t('history.blank');
    return String(value);
  };

  const parts = Object.entries(changes).map(([field, change]) => {
    const label = options.label(field);
    // Id là uuid — hiện ra chỉ tổ rối, nói "đã đổi" là đủ dùng.
    if (field.endsWith('Id')) return t('history.changedOnly', { field: label });
    if (options.unchangedAsContext && change.before === change.after) {
      return `${label} ${read(field, change.after)}`;
    }
    return `${label}: ${read(field, change.before)} → ${read(field, change.after)}`;
  });

  return parts.length > 0 ? parts.join('; ') : null;
}
