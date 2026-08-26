import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { portRangeLabel, type ServicePortRow } from '@/features/catalog/catalog-types';

/**
 * Bảng dịch vụ/port nhỏ đặt NGAY DƯỚI ô nhập port (0028).
 *
 * Vì sao không phải một ô chọn thường: khai NAT là lúc người ta cần thấy CẢ tên lẫn số —
 * "NAS Web · TCP · 5001" — chứ một danh sách chỉ có tên thì phải bung ra từng cái để nhớ nó
 * là port mấy. Bảng nhỏ hiện cả ba cột giải quyết đúng chuyện đó trong một cái liếc.
 *
 * Đây cũng là lý do cuốn sổ NAT có ích: một dòng ghi "5001" thì sáu tháng sau không ai biết
 * nó là gì và không ai dám đóng. Khai một lần rồi chọn lại là cách duy nhất để cột port tự
 * nói ra nó phục vụ dịch vụ gì.
 */
export function ServicePortPicker({
  services,
  onPick,
  onAdd,
  label,
}: {
  services: ServicePortRow[];
  onPick: (service: ServicePortRow) => void;
  onAdd: () => void;
  /** Ghép vào tên trợ năng của từng nút — "Chọn HTTPS cho port ngoài". */
  label: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const term = query.trim().toLowerCase();
  const rows = term
    ? services.filter(
        (service) =>
          service.name.toLowerCase().includes(term) ||
          portRangeLabel(service).includes(term),
      )
    : services;

  return (
    <div className="svc-picker">
      <div className="svc-head">
        <input
          className="inp sm"
          type="search"
          value={query}
          placeholder={t('nat.serviceSearch')}
          aria-label={t('nat.serviceSearchOf', { field: label })}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="btn sm" onClick={onAdd}>
          {t('nat.serviceAdd')}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="svc-empty">{t('nat.serviceEmpty')}</p>
      ) : (
        <div className="svc-list">
          {rows.map((service) => (
            <button
              key={service.id}
              type="button"
              className="svc-row"
              aria-label={t('nat.servicePick', { service: service.name, field: label })}
              onClick={() => onPick(service)}
            >
              <span className="svc-name">{service.name}</span>
              <span className="badge muted plain">
                {service.protocol === 'both'
                  ? t('catalog.protocolBoth')
                  : service.protocol.toUpperCase()}
              </span>
              <span className="svc-port mono">{portRangeLabel(service)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
