import { useTranslation } from 'react-i18next';
import { InfinityIcon } from '@/ui/glyph-icons';

/**
 * Kỳ hạn "Vĩnh viễn" của license mua đứt. Một chỗ vẽ cho mọi màn (danh sách, ô ghế, khu bung
 * license của máy, trang chi tiết) để chữ và hình không lệch nhau giữa các nơi.
 *
 * Tone trung tính có viền (`badge outline`): đây là thông tin về KỲ HẠN, không phải mức an toàn
 * nên không mượn màu xanh của "Còn N ngày". `plain` = chỉ hình + chữ, cho dòng phụ dưới một
 * badge trạng thái khác (hai khung chồng nhau thì rối).
 */
export function PerpetualBadge({ plain = false }: { plain?: boolean }) {
  const { t } = useTranslation();
  return (
    <span className={plain ? 'with-icon' : 'badge outline plain with-icon'}>
      <InfinityIcon />
      {t('software.perpetual')}
    </span>
  );
}
