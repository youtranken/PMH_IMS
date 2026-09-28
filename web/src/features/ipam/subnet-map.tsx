import { useTranslation } from 'react-i18next';
import { slotStatus } from './slot-paging';
import type { IpRow, SubnetSlot } from './ipam-types';

/**
 * Bản đồ của MỘT dải: mỗi địa chỉ một ô, xếp theo thứ tự.
 *
 * Danh sách trả lời "IP này của ai"; bản đồ trả lời câu danh sách không trả lời được bằng một
 * cái liếc — "chỗ trống liền nhau nằm ở đâu" — mà không phải lật sáu trang "Trống — — —".
 * /24 thành lưới 16 cột; dải nhỏ hơn 8 cột để ô không bé tí giữa một khung rộng.
 *
 * Chỉ là một CÁCH XEM khác của cùng dữ liệu: bấm ô trống thì mở đúng hộp Cấp IP, bấm ô đang
 * dùng thì quay về danh sách ở đúng dòng đó — không có đường ghi thứ hai.
 */
export function SubnetMap({
  cidr,
  slots,
  gateway,
  canAssign,
  onAssign,
  onOpen,
}: {
  cidr: string;
  slots: SubnetSlot[];
  gateway: string | null;
  canAssign: boolean;
  onAssign: (address: string, record: IpRow | null) => void;
  onOpen: (address: string) => void;
}) {
  const { t } = useTranslation();
  const columns = slots.length > 64 ? 16 : 8;
  return (
    <div>
      <p className="muted">{t('ipam.mapHint')}</p>
      <div
        className="ip-map"
        role="group"
        aria-label={t('ipam.mapLabel', { cidr })}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {slots.map((slot) => {
          const bucket = slotStatus(slot);
          const isGateway = slot.address === gateway;
          const lastOctet = slot.address.split('.').pop();
          const owner =
            slot.kind === 'record'
              ? [slot.deviceCode, slot.usedBy].filter(Boolean).join(' · ')
              : '';
          const label =
            bucket === 'free'
              ? t('ipam.mapFree', { address: slot.address })
              : `${slot.address} — ${owner || t(bucket === 'voided' ? 'ipam.voidedBadge' : 'ipam.statusAssigned')}`;
          const free = bucket === 'free';
          return (
            <button
              key={slot.address}
              type="button"
              className={`ip-cell is-${bucket}${isGateway ? ' is-gw' : ''}`}
              title={isGateway ? `${label} · ${t('ipam.mapGateway')}` : label}
              aria-label={isGateway ? `${label} · ${t('ipam.mapGateway')}` : label}
              disabled={free && !canAssign}
              onClick={() =>
                free
                  ? onAssign(slot.address, slot.kind === 'record' ? slot : null)
                  : onOpen(slot.address)
              }
            >
              {lastOctet}
            </button>
          );
        })}
      </div>
    </div>
  );
}
