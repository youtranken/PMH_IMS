import { useTranslation } from 'react-i18next';
import { rackUnitLabel, rackWindow } from '@/lib/rack-units';
import { RailCard } from '@/ui/detail-layout';
import { useCabinetOccupants } from '@/ui/use-cabinet-occupants';

/** Số U vẽ thêm trên và dưới máy — đủ thấy hàng xóm mà thẻ cột phải không dài quá màn. */
const AROUND_U = 4;

/**
 * Thẻ "Trong tủ T-1" ở cột phải trang thiết bị (Q-27): khúc tủ quanh máy, máy này tô nổi. Trả lời
 * câu của người đứng trước tủ: máy nằm giữa máy nào, trên dưới còn trống không.
 *
 * Máy không gắn tủ thì không vẽ — vị trí đã ở dải 4 ô đầu trang.
 */
export function CabinetPeek({
  device,
  cabinetHeight,
}: {
  device: { id: string; cabinetId: string | null; cabinetCode: string | null; rackUStart?: number | null };
  cabinetHeight: number | null;
}) {
  const { t } = useTranslation();
  const occupants = useCabinetOccupants(device.cabinetId);
  if (!device.cabinetId) return null;
  const slices = rackWindow(occupants.data ?? [], device.id, cabinetHeight, AROUND_U);
  return (
    <RailCard title={t('devices.cabinetCard', { cabinet: device.cabinetCode ?? '' })}>
      {device.rackUStart == null ? (
        <p className="muted small">{t('devices.cabinetNoU')}</p>
      ) : occupants.isPending ? (
        <p className="muted small">{t('app.loading')}</p>
      ) : (
        <ol className="rack-peek">
          {slices.map((slice) => (
            <li
              key={slice.from}
              className="rack-peek-row"
              data-kind={slice.self ? 'self' : slice.code ? 'used' : 'empty'}
              aria-current={slice.self ? 'true' : undefined}
            >
              <span className="rack-peek-u mono">{rackUnitLabel(slice.from, slice.to - slice.from + 1)}</span>
              <span className="rack-peek-code">
                {slice.code ? <span className="mono">{slice.code}</span> : t('devices.cabinetEmpty')}
                {slice.self ? <span className="muted"> · {t('devices.cabinetThis')}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </RailCard>
  );
}
