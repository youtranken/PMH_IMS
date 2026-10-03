import { useTranslation } from 'react-i18next';
import { CableSwatch } from '@/ui/cable-swatch';
import type { CableTypeInfo } from './diagram-api';

/**
 * Chú giải màu dây sinh từ danh mục loại dây (Q-23): loại còn dùng, loại đã ngừng dùng kèm
 * "(ngừng dùng)" (dây cũ vẫn giữ màu), cộng ba dấu IMS — chưa khai loại dây, chưa khai vào sơ đồ
 * cổng (vàng), kết nối đã gỡ (đỏ). Không có chữ màu nào viết tay ở đây.
 */
export function CableLegend({ cableTypes, floating = false }: { cableTypes: CableTypeInfo[]; floating?: boolean }) {
  const { t } = useTranslation();
  return (
    <ul className={floating ? 'cable-legend' : 'cable-legend-list'} aria-label={t('diagrams.cable.legendTitle')}>
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
}
