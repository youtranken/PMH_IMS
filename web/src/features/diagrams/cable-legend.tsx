import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BREAKPOINTS } from '@/ui/breakpoints';
import { CableSwatch } from '@/ui/cable-swatch';
import { useMediaQuery } from '@/ui/use-media-query';
import type { CableTypeInfo } from './diagram-api';

/**
 * Chú giải màu dây sinh từ danh mục loại dây (Q-23): loại còn dùng, loại đã ngừng dùng kèm
 * "(ngừng dùng)" (dây cũ vẫn giữ màu), cộng ba dấu IMS — chưa khai loại dây, chưa khai vào sơ đồ
 * cổng (vàng), kết nối đã gỡ (đỏ). Không có chữ màu nào viết tay ở đây.
 *
 * `floating` (nổi trên trình xem) thì thu gọn được sau nút "Chú giải dây": ở màn hẹp mặc định
 * ĐÓNG, vì mở sẵn nó che gần hết bản vẽ và đè lên nút thu phóng (UX-DR2).
 */
export function CableLegend({ cableTypes, floating = false }: { cableTypes: CableTypeInfo[]; floating?: boolean }) {
  const { t } = useTranslation();
  const narrow = useMediaQuery(BREAKPOINTS.editor);
  const [open, setOpen] = useState(!narrow);
  const listId = useId();
  const list = (
    <ul id={listId} className="cable-legend-list" aria-label={t('diagrams.cable.legendTitle')}>
      {cableTypes.map((cable) => (
        <li key={cable.id}>
          <CableSwatch slot={cable.colorSlot} />
          <span>
            {cable.name}
            {cable.active ? null : <span className="muted"> {t('diagrams.cable.retiredSuffix')}</span>}
          </span>
        </li>
      ))}
      <li>
        <CableSwatch slot={0} />
        <span>{t('diagrams.cable.legendNone')}</span>
      </li>
      <li>
        <CableSwatch paint="warn" />
        <span>{t('diagrams.cable.legendUndeclared')}</span>
      </li>
      <li>
        <CableSwatch paint="danger" />
        <span>{t('diagrams.cable.legendRemoved')}</span>
      </li>
    </ul>
  );
  if (!floating) return list;
  return (
    <div className="cable-legend" data-open={open ? 'true' : undefined}>
      <button type="button" className="btn sm ghost" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen((v) => !v)}>
        {t('diagrams.cable.legendToggle')}
      </button>
      {open ? list : null}
    </div>
  );
}
