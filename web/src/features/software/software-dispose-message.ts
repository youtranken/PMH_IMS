import type { TFunction } from 'i18next';
import { apiFetch } from '@/lib/api-client';

/** Quá số máy này thì câu hỏi lại chỉ nói số: 11 mã máy làm câu hỏi dài hơn màn điện thoại. */
const LIST_LIMIT = 10;

/**
 * Câu hỏi lại khi thanh lý phần mềm. Thanh lý thì hệ thống TỰ GỠ mọi ghế (Q-11, Q-13), nên
 * câu phải nói đúng điều đó — người dùng bấm xác nhận dựa trên chính câu này.
 *
 * `codes = null` là chưa đọc được danh sách máy: vẫn nói số ghế lấy từ hồ sơ, không im lặng.
 */
export function softwareDisposeMessage(
  t: TFunction,
  code: string,
  seatUsed: number,
  codes: string[] | null,
): string {
  const count = codes?.length ?? seatUsed;
  const seats =
    count === 0
      ? null
      : codes && codes.length <= LIST_LIMIT
        ? t('disposal.confirmSoftwareSeats', { count, codes: codes.join(', ') })
        : t('disposal.confirmSoftwareSeatsMany', { count });
  return [t('disposal.confirmSoftware', { code }), seats, t('disposal.confirmSoftwareTail')]
    .filter(Boolean)
    .join(' ');
}

/**
 * Mã các máy đang giữ ghế — đọc NGAY LÚC hỏi lại, không đọc sẵn cho mọi dòng của danh sách.
 * Lỗi thì trả `null` để câu hỏi lùi về số ghế, không chặn việc thanh lý.
 */
export async function activeSeatCodes(softwareId: string): Promise<string[] | null> {
  try {
    const rows = await apiFetch<{ deviceCode: string }[]>(
      `/api/v1/software/${softwareId}/assignments?includeReleased=false`,
    );
    return rows.map((row) => row.deviceCode);
  } catch {
    return null;
  }
}
