import { useTranslation } from 'react-i18next';
import { rackRows, type RackOccupant } from '@/lib/rack-units';

/**
 * Mặt đứng một tủ rack (AD-15, dùng chung): mỗi U một dòng, U cao nhất ở trên — đúng quy ước U1
 * ở ĐÁY tủ của khung tủ trên sơ đồ và ràng buộc chồng U. Dòng có máy hiện mã máy (máy nhiều U
 * chiếm đủ các dòng); dòng trống có nút chọn khi nơi gọi truyền `onPick` — không truyền thì chỉ đọc
 * (màn hẹp, trang đọc).
 */
export function RackElevation({
  label,
  height,
  occupants,
  selfId,
  onPick,
}: {
  /** Tên tủ cho trình đọc màn hình ("HCM · R1"). */
  label: string;
  /** `cabinet.u_height`; `null` = tủ chưa khai chiều cao. */
  height: number | null;
  occupants: readonly RackOccupant[];
  /** Máy đang sửa — dòng của nó ghi "(máy này)". */
  selfId?: string | null;
  onPick?: (u: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <ol className="rack-el" aria-label={t('rack.unitsOf', { name: label })} reversed>
      {rackRows(height, occupants).map(({ u, occupant }) => {
        const mine = occupant && occupant.id === selfId;
        return (
          <li key={u} className="rack-el-row" data-state={mine ? 'self' : occupant ? 'taken' : 'free'}>
            <span className="rack-el-u">{`U${u}`}</span>
            {occupant ? (
              <span className="rack-el-device">{mine ? t('rack.self', { code: occupant.code }) : occupant.code}</span>
            ) : onPick ? (
              <button type="button" className="linkbtn rack-el-free" aria-label={t('rack.pick', { u })} onClick={() => onPick(u)}>
                {t('rack.free')}
              </button>
            ) : (
              <span className="muted rack-el-free">{t('rack.free')}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
