import { useTranslation } from 'react-i18next';
import { addYearsIso } from '@/lib/add-years';

/**
 * Hàng nút "+1 năm · +2 năm · +3 năm" đặt một ngày cuối = ngày mốc + n năm.
 *
 * Hạn (bảo hành, hợp đồng) gần như luôn là "mốc + vài năm": ba chạm thay cho ba chục lần lật
 * tháng trong lịch. Cộng năm qua `addYearsIso` (số nguyên, không qua `Date`) để 29/02 lùi về
 * 28/02 và không trượt ngày theo múi giờ.
 *
 * Chưa có mốc thì nút TẮT chứ không ẩn: ẩn đi thì người dùng không biết có lối tắt này, còn
 * tắt kèm `title` nói phải điền gì trước.
 */
export function YearQuickPicks({
  base,
  onPick,
  label,
  needBaseHint,
  years = [1, 2, 3],
}: {
  /** Ngày mốc ISO `yyyy-mm-dd`; rỗng = chưa có mốc, mọi nút tắt. */
  base: string;
  onPick: (iso: string) => void;
  /** Tên của nhóm nút cho trình đọc màn hình ("Đặt nhanh hạn bảo hành"). */
  label: string;
  /** Lý do nút tắt khi chưa có mốc — hiện ở `title`. */
  needBaseHint?: string;
  years?: number[];
}) {
  const { t } = useTranslation();
  return (
    <span className="chip-row" role="group" aria-label={label}>
      {years.map((count) => (
        <button
          key={count}
          type="button"
          className="btn sm ghost"
          disabled={!base}
          title={base ? undefined : needBaseHint}
          onClick={() => onPick(addYearsIso(base, count))}
        >
          {t('common.plusYears', { count })}
        </button>
      ))}
    </span>
  );
}
