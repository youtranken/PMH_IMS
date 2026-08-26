import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Combobox } from '@/ui/combobox';
import { portRangeLabel, type ServicePortRow } from '@/features/catalog/catalog-types';

/**
 * Ô chọn dịch vụ/port (0028) — DROPDOWN xổ khi bấm, không phải bảng bày sẵn.
 *
 * Bản đầu là một bảng nhỏ luôn mở dưới ô nhập, lý lẽ là "khai NAT cần thấy cả tên lẫn số
 * cùng lúc". Lý lẽ đó đúng, nhưng cái giá thì sai: form NAT có HAI ô port nên có HAI bảng
 * giống hệt nhau luôn mở, cộng lại chiếm quá nửa hộp thoại và đẩy nút Lưu ra khỏi tầm nhìn.
 *
 * Dropdown giữ nguyên phần đúng: mỗi dòng vẫn hiện đủ **tên · giao thức · port**, gõ để lọc,
 * và có dòng "＋ Thêm dịch vụ" ghim đầu menu cho dịch vụ chưa khai. Chỉ khác là nó nằm gọn
 * cho tới khi được bấm.
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
  /** Ghép vào tên trợ năng — "Chọn dịch vụ cho Port ngoài". */
  label: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const term = query.trim().toLowerCase();
  const rows = term
    ? services.filter(
        (service) =>
          service.name.toLowerCase().includes(term) || portRangeLabel(service).includes(term),
      )
    : services;

  return (
    <Combobox
      placeholder={t('nat.servicePickerPlaceholder')}
      ariaLabel={t('nat.serviceSearchOf', { field: label })}
      query={query}
      onQuery={setQuery}
      options={rows}
      getKey={(service) => service.id}
      renderOption={(service) => (
        <span className="svc-opt">
          <span className="svc-name">{service.name}</span>
          <span className="badge muted plain">
            {service.protocol === 'both'
              ? t('catalog.protocolBoth')
              : service.protocol.toUpperCase()}
          </span>
          <span className="svc-port mono">{portRangeLabel(service)}</span>
        </span>
      )}
      onSelect={(service) => {
        onPick(service);
        // Xoá từ khoá sau khi chọn: ô này KHÔNG giữ giá trị (giá trị đi vào ô port bên trên),
        // để nguyên chữ cũ thì lần mở sau menu đã bị lọc sẵn mà không ai biết vì sao.
        setQuery('');
      }}
      action={{ label: t('nat.serviceAdd'), onClick: onAdd }}
    />
  );
}
