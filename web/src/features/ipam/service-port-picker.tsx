import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Combobox } from '@/ui/combobox';
import { portRangeLabel, type ServicePortRow } from '@/lib/catalog-types';
import { foldSearch } from '@/lib/search-fold';

/**
 * Ô chọn dịch vụ/port — DROPDOWN xổ khi bấm, không phải bảng bày sẵn.
 *
 * Một bảng nhỏ luôn mở dưới ô nhập thì đúng lý lẽ "khai NAT cần thấy cả tên lẫn số cùng
 * lúc", nhưng cái giá thì sai: form NAT có HAI ô port nên có HAI bảng giống hệt nhau luôn
 * mở, cộng lại chiếm quá nửa hộp thoại và đẩy nút Lưu ra khỏi tầm nhìn.
 *
 * Dropdown giữ nguyên phần đúng: mỗi dòng vẫn hiện đủ **tên · giao thức · port**, gõ để lọc,
 * và có dòng "＋ Thêm dịch vụ" ghim đầu menu cho dịch vụ chưa khai. Chỉ khác là nó nằm gọn
 * cho tới khi được bấm.
 */
export function ServicePortPicker({
  services,
  pending,
  onPick,
  onAdd,
  label,
}: {
  services: ServicePortRow[];
  /**
   * Danh mục dịch vụ ĐANG TẢI — nối thẳng `lists.isPending` vào đây.
   *
   * Thiếu nó thì trong lúc danh mục còn bay, menu nói "không có dịch vụ nào khớp" kèm dòng
   * "＋ Khai dịch vụ mới" — tức MỜI người dùng khai trùng một dịch vụ đã có sẵn.
   */
  pending?: boolean;
  onPick: (service: ServicePortRow) => void;
  onAdd: () => void;
  /** Ghép vào tên trợ năng — "Chọn dịch vụ cho Port ngoài". */
  label: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  // Gấp dấu cả hai vế — tên dịch vụ là tiếng Việt ("Quản trị từ xa"), nhãn dải port
  // thì không, nhưng cho cả hai đi qua cùng một phép gấp là cách duy nhất để chúng cùng luật.
  const term = foldSearch(query.trim());
  const rows = term
    ? services.filter(
        (service) =>
          foldSearch(service.name).includes(term) ||
          foldSearch(portRangeLabel(service)).includes(term),
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
        // Việc menu tự bung lại vì `options` đổi danh tính đã chặn ở chính `Combobox`.
        setQuery('');
      }}
      action={{ label: t('nat.serviceAdd'), onClick: onAdd }}
      /* Lọc không ra thì NÓI RA, đừng để người dùng nhìn một menu trống rồi tự đoán. */
      empty={t('nat.serviceEmpty')}
      pending={pending}
    />
  );
}
