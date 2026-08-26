import { useTranslation } from 'react-i18next';
import { formatDate } from '@/lib/format';
import { ExpiryBadge } from '@/ui/expiry-badge';
import type { LicenseModel, SeatTerms } from './software-types';

/**
 * Ô "hết hạn" của một chỗ ngồi license — dùng ở CẢ BA chỗ đang hiển thị ghế: khu bung dòng
 * ở danh sách phần mềm, khu bung dòng ở danh sách thiết bị, và tab Máy đang dùng.
 *
 * Gom lại vì ba chỗ này phải trả lời giống hệt nhau. Ghế của một license mua đứt mà chỗ
 * này ghi "—" còn chỗ kia ghi "Vĩnh viễn" là kiểu sai không ai báo lỗi, chỉ làm người dùng
 * mất tin dần vào con số trên màn.
 */
export function SeatEndCell({
  seat,
  licenseModel,
  fallbackEnd,
}: {
  seat: SeatTerms;
  licenseModel: LicenseModel;
  /** Hạn của HỒ SƠ — dùng khi ghế không khai kỳ hạn riêng. */
  fallbackEnd?: string | null;
}) {
  const { t } = useTranslation();

  // Mua đứt: nói thẳng "Vĩnh viễn". Để trống thì người đọc tưởng thiếu dữ liệu, mà đây là
  // trạng thái hoàn toàn bình thường.
  if (licenseModel === 'perpetual') {
    return <span className="badge ok plain">{t('software.perpetual')}</span>;
  }
  // AD-15: luật "sắp hết hạn" chỉ có một, ở lib/expiry.ts.
  if (seat.endDate) return <ExpiryBadge end={seat.endDate} />;
  if (fallbackEnd) {
    // Ghế không có kỳ hạn riêng thì đi theo hồ sơ — nói rõ như vậy, đừng hiện con số của
    // hồ sơ như thể người dùng đã khai riêng cho ghế này.
    return (
      <span className="seat-inherit">
        <ExpiryBadge end={fallbackEnd} />
        <small className="muted">{t('license.termFromProfile')}</small>
      </span>
    );
  }
  return <span className="muted">—</span>;
}

/** Kỳ hạn gọn một dòng "01/01/2026 → 31/12/2026" cho bảng ở tab Máy đang dùng. */
export function SeatTerm({
  seat,
  licenseModel,
}: {
  seat: SeatTerms;
  licenseModel: LicenseModel;
}) {
  const { t } = useTranslation();
  if (licenseModel === 'perpetual') {
    return <span className="badge ok plain">{t('software.perpetual')}</span>;
  }
  if (!seat.startDate && !seat.endDate) {
    return <span className="muted">{t('license.termFromProfile')}</span>;
  }
  return (
    <span className="seat-date">
      {seat.startDate ? formatDate(seat.startDate) : '—'} →{' '}
      {seat.endDate ? formatDate(seat.endDate) : '—'}
    </span>
  );
}
