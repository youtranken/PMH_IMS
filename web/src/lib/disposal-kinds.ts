/**
 * Ba loại hồ sơ vào kho thanh lý + nhãn i18n của chúng — MỘT nơi khai (AD-15).
 *
 * Dùng ở hai màn: kho thanh lý (`/disposal`) và khối "vừa thanh lý" trên bảng điều khiển. Để
 * bản gốc trong `features/disposal/` rồi cho bảng điều khiển import chéo sang là phá đúng cái
 * ranh giới mà AD-15 dựng lên — thứ dùng ở ≥2 màn thì không thuộc về màn nào.
 *
 * Khớp `DISPOSAL_KINDS` bên API (`api/src/modules/disposal/disposal.service.ts`). Thêm loại
 * thứ tư phải sửa cả hai đầu; ở đây `Record` bắt đủ khóa nên thiếu nhãn là TS đỏ, không phải
 * một ô trống trên màn hình.
 */
export const DISPOSAL_KINDS = ['device', 'software', 'service_account'] as const;

export type DisposalKind = (typeof DISPOSAL_KINDS)[number];

export const DISPOSAL_KIND_KEY: Record<DisposalKind, string> = {
  device: 'disposal.kindDevice',
  software: 'disposal.kindSoftware',
  service_account: 'disposal.kindServiceAccount',
};
