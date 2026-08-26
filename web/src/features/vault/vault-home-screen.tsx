import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { Dialog } from '@/ui/dialog';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { VaultPanel } from '@/ui/vault-panel';

type OwnerType = 'device' | 'software';

interface VaultOwner {
  ownerType: OwnerType;
  ownerId: string;
  code: string;
  name: string;
  siteCode: string | null;
  secretCount: number;
  lastChangeAt: string;
  orphan: boolean;
}

/**
 * Trang tổng Két sắt (`/vault`).
 *
 * Nó liệt kê **CHỦ THỂ đang giữ secret**, KHÔNG liệt kê secret: không tên ngăn, không giá
 * trị. FR-026 cấm mọi đường lấy secret qua nhiều chủ thể, và ranh giới đó được canh cả ở
 * `vault-surface.spec.ts` lẫn ở bài E2E của màn này.
 *
 * Bấm một dòng thì mở POPUP ngay tại chỗ thay vì chuyển trang — xem xong đóng lại là vẫn
 * đứng nguyên danh sách, không phải bấm quay lại rồi cuộn tìm lại dòng cũ. Popup nhúng đúng
 * `VaultPanel` đang dùng ở tab của trang chi tiết (AD-15), nên luật mở két — gõ TOTP, tự ẩn,
 * ghi nhật ký — y hệt, không có bản thứ hai để mà trôi lệch.
 */
export function VaultHomeScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  /** Lọc theo loại — chọn được NHIỀU cùng lúc; rỗng = xem tất cả. */
  const [kinds, setKinds] = useState<OwnerType[]>([]);
  const [opened, setOpened] = useState<VaultOwner | null>(null);

  const owners = useQuery({
    queryKey: ['vault', 'owners'],
    queryFn: () => apiFetch<VaultOwner[]>('/api/v1/vault/owners'),
  });

  /** Ghi vào két vẫn chỉ SA/Admin — API chặn, UI đừng bày nút ra để bấm rồi 403. */
  const canEdit = me.role === 'sa' || me.role === 'admin';

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (owners.data ?? []).filter((row) => {
      if (kinds.length > 0 && !kinds.includes(row.ownerType)) return false;
      if (!term) return true;
      return (
        row.code.toLowerCase().includes(term) ||
        row.name.toLowerCase().includes(term) ||
        (row.siteCode ?? '').toLowerCase().includes(term)
      );
    });
  }, [owners.data, kinds, search]);

  const all = owners.data ?? [];
  const totalSecrets = all.reduce((sum, row) => sum + row.secretCount, 0);
  const toggle = (kind: OwnerType) =>
    setKinds((current) =>
      current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind],
    );

  return (
    <>
      <PageHeader title={t('vaultHome.title')} subtitle={t('vaultHome.subtitle')} />

      <p className="alert">{t('vaultHome.whereItLives')}</p>

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('vaultHome.searchPlaceholder')}
      >
        {/* Hai nút bật/tắt độc lập, không phải một ô chọn: "xem cả thiết bị lẫn phần mềm"
            là trạng thái thường gặp nhất, mà ô chọn một-giá-trị không diễn tả được. */}
        {(['device', 'software'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            className={`btn${kinds.includes(kind) ? ' primary' : ''}`}
            aria-pressed={kinds.includes(kind)}
            onClick={() => toggle(kind)}
          >
            {t(kind === 'device' ? 'vaultHome.devices' : 'vaultHome.software')}
          </button>
        ))}
      </FilterBar>

      {owners.isLoading ? (
        <Loading />
      ) : owners.isError ? (
        <LoadError onRetry={() => void owners.refetch()} />
      ) : all.length === 0 ? (
        <EmptyState title={t('vaultHome.empty')} hint={t('vaultHome.emptyHint')} />
      ) : (
        <>
          <p className="muted">
            {t('vaultHome.summary', { owners: all.length, secrets: totalSecrets })}
          </p>

          {rows.length === 0 ? (
            <EmptyState title={t('vaultHome.noHit')} hint={t('vaultHome.noHitHint')} />
          ) : (
            <div className="table-wrap">
              <table className="table table-stack">
                <thead>
                  <tr>
                    <th>{t('vaultHome.owner')}</th>
                    <th>{t('vaultHome.ownerKind')}</th>
                    <th className="num">{t('vaultHome.secretCount')}</th>
                    <th>{t('vaultHome.lastChange')}</th>
                    <th className="col-center">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.ownerType}-${row.ownerId}`}>
                      <td data-label={t('vaultHome.owner')}>
                        <span className="mono">{row.code}</span>
                        <span className="cell-sub">
                          {row.orphan ? t('vaultHome.orphan') : row.name}
                          {row.siteCode ? ` · ${row.siteCode}` : ''}
                        </span>
                      </td>
                      <td data-label={t('vaultHome.ownerKind')}>
                        <span className="badge plain">
                          {t(
                            row.ownerType === 'device'
                              ? 'vaultHome.kindDevice'
                              : 'vaultHome.kindSoftware',
                          )}
                        </span>
                      </td>
                      <td className="num" data-label={t('vaultHome.secretCount')}>
                        {row.secretCount}
                      </td>
                      <td data-label={t('vaultHome.lastChange')}>
                        {formatDateTime(row.lastChangeAt)}
                      </td>
                      <td>
                        <div className="action-cell">
                          <button
                            type="button"
                            className="btn sm"
                            aria-label={t('vaultHome.openOf', { code: row.code })}
                            onClick={() => setOpened(row)}
                          >
                            {t('vaultHome.open')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {opened ? (
        <Dialog
          open
          onOpenChange={() => setOpened(null)}
          maxWidth={860}
          title={`${t('vaultHome.title')} — ${opened.code}${opened.name ? ` · ${opened.name}` : ''}`}
          footer={
            <>
              {/* Đường sang hồ sơ đầy đủ vẫn giữ: xem két xong thường là muốn xem cả máy. */}
              {opened.orphan ? null : (
                <Link
                  className="btn"
                  to={
                    opened.ownerType === 'device'
                      ? PATHS.device(opened.ownerId)
                      : PATHS.softwareItem(opened.ownerId)
                  }
                >
                  {t('vaultHome.openRecord')}
                </Link>
              )}
              <button type="button" className="btn primary" onClick={() => setOpened(null)}>
                {t('common.close')}
              </button>
            </>
          }
        >
          <VaultPanel
            ownerType={opened.ownerType}
            ownerId={opened.ownerId}
            me={me}
            canEdit={canEdit}
          />
        </Dialog>
      ) : null}

      <section className="form-section">
        <h2 className="form-section-title">{t('vaultHome.rulesTitle')}</h2>
        <ul className="vault-rules">
          <li>{t('vaultHome.rule1')}</li>
          <li>{t('vaultHome.rule2')}</li>
          <li>{t('vaultHome.rule3')}</li>
          <li>{t('vaultHome.rule4')}</li>
        </ul>
      </section>
    </>
  );
}
