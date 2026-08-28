import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { formatDate, orDash } from '@/lib/format';
import { OWNER_PATH } from '@/lib/routes';
import {
  DISPOSAL_KIND_KEY as KIND_KEY,
  type DisposalKind,
} from '@/lib/disposal-kinds';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';

interface DisposalItem {
  kind: DisposalKind;
  id: string;
  code: string;
  name: string;
  detail: string | null;
  status: string;
  updatedAt: string | null;
}

/**
 * Đường về hồ sơ gốc — kho thanh lý chỉ NHÌN, sửa thì về đúng module chủ.
 *
 * Dùng `OWNER_PATH` dùng chung chứ không giữ bản riêng: bảng điều khiển cũng dựng link từ một
 * cặp `(loại, id)` y hệt, và hai bản chép tay sẽ lệch nhau khi có loại thứ tư vào kho.
 */
const LINK = OWNER_PATH;

/**
 * Kho thanh lý — MỘT chỗ nhìn thấy mọi thứ công ty đã ngừng dùng.
 *
 * Vì sao cần: ba loại hồ sơ có ba trạng thái "ngừng dùng" mang ba cái tên khác nhau (thiết bị
 * *đã thanh lý*, phần mềm *đã bỏ*, tài khoản *đã vô hiệu*), nằm ở ba màn khác nhau. Câu "công
 * ty đã bỏ những gì trong quý này" vì thế không ai trả lời được, dù dữ liệu đã có đủ từ lâu.
 *
 * Màn này KHÔNG ghi gì. Đưa một hồ sơ vào kho là việc của chính module chủ, dưới đúng cái tên
 * mà module đó dùng — thêm một đường ghi thứ hai ở đây là tạo ra hai nguồn sự thật cho cùng
 * một trạng thái.
 *
 * Chuyện "không tính hạn, không vào email digest" thì các module đã lo sẵn: mọi nguồn hạn lọc
 * `status <> retired` ngay trong truy vấn của mình.
 */
export function DisposalScreen() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'' | DisposalKind>('');

  const items = useQuery({
    queryKey: ['disposal'],
    queryFn: () => apiFetch<DisposalItem[]>('/api/v1/disposal'),
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (items.data ?? []).filter((item) => {
      if (kind && item.kind !== kind) return false;
      if (!term) return true;
      return (
        item.code.toLowerCase().includes(term) ||
        item.name.toLowerCase().includes(term) ||
        (item.detail ?? '').toLowerCase().includes(term)
      );
    });
  }, [items.data, search, kind]);

  /* Đếm theo loại trên TOÀN BỘ, không theo tập đang lọc: nút lọc mà mang con số của chính
     tập đã lọc thì bấm vào đâu cũng thấy "đúng", và nó hết là bộ đếm. */
  const countOf = (target: DisposalKind) =>
    (items.data ?? []).filter((item) => item.kind === target).length;

  return (
    <>
      <PageHeader title={t('disposal.title')} subtitle={t('disposal.subtitle')} />

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('disposal.search')}
      >
        <div className="segmented" role="group" aria-label={t('disposal.filterKind')}>
          <button
            type="button"
            className={kind === '' ? 'on' : undefined}
            aria-pressed={kind === ''}
            onClick={() => setKind('')}
          >
            {t('disposal.allKinds')} {(items.data ?? []).length}
          </button>
          {(Object.keys(KIND_KEY) as DisposalKind[]).map((key) => (
            <button
              key={key}
              type="button"
              className={kind === key ? 'on' : undefined}
              aria-pressed={kind === key}
              onClick={() => setKind(key)}
            >
              {t(KIND_KEY[key])} {countOf(key)}
            </button>
          ))}
        </div>
      </FilterBar>

      <p className="alert">{t('disposal.note')}</p>

      {items.isLoading ? (
        <Loading />
      ) : items.isError ? (
        <LoadError onRetry={() => void items.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('disposal.empty')} hint={t('disposal.emptyHint')} />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>{t('disposal.code')}</th>
                <th>{t('disposal.kind')}</th>
                <th>{t('disposal.detail')}</th>
                <th>{t('disposal.at')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={`${item.kind}-${item.id}`}>
                  <td data-label={t('disposal.code')}>
                    {/* Vẫn mở được hồ sơ gốc: "đã thanh lý" không phải "đã xoá", và người ta
                        mở nó ra chính để đọc lịch sử vì sao bỏ. */}
                    <Link className="mono" to={LINK[item.kind](item.id)}>
                      {item.code}
                    </Link>
                    <span className="cell-sub">{item.name}</span>
                  </td>
                  <td data-label={t('disposal.kind')}>
                    <span className="badge plain">{t(KIND_KEY[item.kind])}</span>
                  </td>
                  <td data-label={t('disposal.detail')}>{orDash(item.detail)}</td>
                  <td data-label={t('disposal.at')}>{orDash(formatDate(item.updatedAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
