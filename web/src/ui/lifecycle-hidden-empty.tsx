import type { ReactNode } from 'react';
import { useQuery, type QueryKey } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { PATHS } from '@/lib/routes';
import { EmptyState, Loading } from '@/ui/load-state';

/**
 * Khối trống của các màn ẩn hồ sơ cuối đời theo mặc định (Q-20): Thiết bị, Phần mềm, Đường
 * truyền, Tài khoản dịch vụ.
 *
 * Bảng trống ở bộ lọc mặc định chưa chắc là "kho trống" hay "không khớp": có thể mọi hồ sơ khớp
 * đều đã thanh lý. Nói sai thì người dùng thêm lại một máy đã có, hoặc tưởng gõ sai mã. Nên hỏi
 * thêm MỘT lượt (cùng bộ lọc, kể cả cuối đời, `limit=1`) rồi mới quyết câu nào.
 *
 * `probeUrl = null` khi người dùng đã chọn trạng thái đích danh: lúc đó không có gì bị ẩn, và
 * khối trống gốc của màn (`fallback`) là câu đúng.
 */
export function LifecycleHiddenEmpty({
  probeKey,
  probeUrl,
  endLabel,
  allLabel,
  onShowAll,
  fallback,
}: {
  probeKey: QueryKey;
  probeUrl: string | null;
  /** Tên trạng thái cuối đời của màn ("Đã thanh lý" / "Đã ngừng dùng"). */
  endLabel: string;
  /** Chữ của mục "Tất cả (cả …)" trong ô lọc — nút ở đây đọc đúng chữ đó. */
  allLabel: string;
  onShowAll: () => void;
  fallback: ReactNode;
}) {
  const { t } = useTranslation();
  const probe = useQuery({
    queryKey: probeKey,
    enabled: probeUrl !== null,
    queryFn: () => apiFetch<{ total: number }>(probeUrl as string),
  });
  if (probeUrl === null) return <>{fallback}</>;
  if (probe.isLoading) return <Loading />;
  const hidden = probe.data?.total ?? 0;
  if (hidden === 0) return <>{fallback}</>;
  return (
    <EmptyState
      title={t('common.lifecycleHidden', { end: endLabel.toLocaleLowerCase('vi'), count: hidden })}
      hint={t('common.lifecycleHiddenHint', { all: allLabel })}
      action={
        <>
          <button type="button" className="btn" onClick={onShowAll}>
            {allLabel}
          </button>{' '}
          <Link className="linkbtn" to={PATHS.disposal}>
            {t('nav.disposal')}
          </Link>
        </>
      }
    />
  );
}
