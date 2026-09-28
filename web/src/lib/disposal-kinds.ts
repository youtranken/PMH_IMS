/**
 * Các loại hồ sơ vào kho thanh lý + nhãn i18n của chúng — MỘT nơi khai (AD-15).
 *
 * Dùng ở hai màn: kho thanh lý (`/disposal`) và khối "vừa thanh lý" trên bảng điều khiển. Để
 * bản gốc trong `features/disposal/` rồi cho bảng điều khiển import chéo sang là phá đúng cái
 * ranh giới mà AD-15 dựng lên — thứ dùng ở ≥2 màn thì không thuộc về màn nào.
 *
 * Khớp `DISPOSAL_KINDS` bên API (`api/src/modules/disposal/disposal.service.ts`) — bài
 * `disposal-rollcall.test.ts` đọc thẳng file đó để canh. Ở đây `Record` bắt đủ khóa nên
 * thiếu nhãn là TS đỏ, không phải một ô trống trên màn hình.
 */
export const DISPOSAL_KINDS = ['device', 'software', 'service_account', 'isp'] as const;

export type DisposalKind = (typeof DISPOSAL_KINDS)[number];

export const DISPOSAL_KIND_KEY: Record<DisposalKind, string> = {
  device: 'disposal.kindDevice',
  software: 'disposal.kindSoftware',
  service_account: 'disposal.kindServiceAccount',
  isp: 'disposal.kindIsp',
};

/**
 * Trạng thái THEO TÊN CỦA MODULE CHỦ, không dịch về một tên chung.
 *
 * Cố ý không gom thành một chữ "đã bỏ": người dùng quay lại module chủ sẽ thấy đúng chữ ấy
 * trên hồ sơ, và một cái tên chỉ tồn tại ở màn kho là thêm một thứ phải học. Trả `null` cho
 * trạng thái lạ để bên gọi in nguyên văn — thà thấy một chuỗi kỹ thuật còn hơn một ô trống.
 */
const STATUS_KEY = new Map<string, string>([
  ['retired', 'disposal.statusRetired'],
  ['disabled', 'disposal.statusDisabled'],
  ['terminated', 'disposal.statusTerminated'],
]);

export function disposalStatusKey(status: string): string | null {
  return STATUS_KEY.get(status) ?? null;
}

/**
 * Nhãn của cột "Chi tiết" (DP-001). API trả `detail` là MÃ loại của module chủ với phần mềm
 * (`license`, `ssl`…) và tài khoản dịch vụ (`vpn`, `shared`) — in thẳng ra là chữ kỹ thuật tiếng
 * Anh. Dịch qua đúng khoá nhãn mà module chủ dùng; mã lạ hoặc chữ tự do (loại thiết bị, băng
 * thông) thì in nguyên văn.
 */
const DETAIL_KEY: Partial<Record<DisposalKind, Record<string, string>>> = {
  software: {
    license: 'software.kindLicense',
    ssl: 'software.kindSsl',
    domain: 'software.kindDomain',
    maintenance: 'software.kindMaintenance',
    other: 'software.kindOther',
  },
  service_account: {
    shared: 'serviceAccounts.kindShared',
    vpn: 'serviceAccounts.kindVpn',
  },
};

export function disposalDetail(
  kind: DisposalKind,
  detail: string | null,
  t: (key: string) => string,
): string {
  if (!detail) return '—';
  const key = DETAIL_KEY[kind]?.[detail];
  return key ? t(key) : detail;
}
