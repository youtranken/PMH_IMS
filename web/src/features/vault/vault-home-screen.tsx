import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { PATHS } from '@/lib/routes';
import { EmptyState, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';

interface DeviceHit {
  id: string;
  code: string;
  name: string;
}

interface SoftwareHit {
  id: string;
  code: string;
  name: string;
}

/**
 * CỬA VÀO két sắt (`/vault`).
 *
 * Két sắt vốn KHÔNG có trang riêng: nó là một tab bên trong hồ sơ thiết bị / hồ sơ phần mềm.
 * Nhưng mục "Két sắt" trên sidebar lại đang hiện mờ như một màn chưa làm, nên người dùng nhìn
 * vào menu và kết luận là tính năng chưa có — trong khi nó đã chạy từ Epic 4.
 *
 * VÌ SAO ĐÂY KHÔNG PHẢI DANH SÁCH SECRET: **FR-026** cấm mọi đường lấy secret của nhiều hơn
 * một chủ thể, ở mọi quyền — luật đó được cài thẳng vào hình dạng route (`OwnerQueryDto` bắt
 * buộc `ownerType` + `ownerId`, không `@IsOptional`) và có `vault-surface.spec.ts` canh. Một
 * trang "mọi secret trong hệ thống" chính là thứ luật ấy chặn, kể cả khi chỉ hiện tên gọi:
 * bản đồ đầy đủ chỗ cất bí mật cũng là một thứ đáng giá với kẻ tấn công.
 *
 * Nên trang này đi đường ngược lại và đúng nghiệp vụ hơn: tìm CHỦ THỂ (máy nào, phần mềm
 * nào), rồi mở thẳng tab Két sắt của chính chủ thể đó.
 */
export function VaultHomeScreen() {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(id);
  }, [term]);

  const enabled = debounced.length >= 2;

  const devices = useQuery({
    queryKey: ['devices', 'vault-search', debounced],
    enabled,
    queryFn: () =>
      apiFetch<{ items: DeviceHit[] }>(
        `/api/v1/devices?limit=8&search=${encodeURIComponent(debounced)}`,
      ),
  });

  const software = useQuery({
    queryKey: ['software', 'vault-search', debounced],
    enabled,
    queryFn: () =>
      apiFetch<{ items: SoftwareHit[] }>(
        `/api/v1/software?limit=8&search=${encodeURIComponent(debounced)}`,
      ),
  });

  const deviceHits = devices.data?.items ?? [];
  const softwareHits = software.data?.items ?? [];
  const loading = enabled && (devices.isLoading || software.isLoading);
  const nothing = enabled && !loading && deviceHits.length === 0 && softwareHits.length === 0;

  return (
    <>
      <PageHeader title={t('vaultHome.title')} subtitle={t('vaultHome.subtitle')} />

      <p className="alert">{t('vaultHome.whereItLives')}</p>

      <section className="form-section">
        <h2 className="form-section-title">{t('vaultHome.findOwner')}</h2>
        <input
          className="inp"
          type="search"
          aria-label={t('vaultHome.searchLabel')}
          placeholder={t('vaultHome.searchPlaceholder')}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />

        {!enabled ? (
          <p className="field-hint muted">{t('vaultHome.searchHint')}</p>
        ) : loading ? (
          <Loading />
        ) : nothing ? (
          <EmptyState title={t('vaultHome.noHit')} hint={t('vaultHome.noHitHint')} />
        ) : (
          <div className="vault-hits">
            {deviceHits.length > 0 ? (
              <div>
                <h3 className="form-section-title">{t('vaultHome.devices')}</h3>
                <ul className="vault-hit-list">
                  {deviceHits.map((item) => (
                    <li key={item.id}>
                      {/* Đi THẲNG vào tab Két sắt của chính hồ sơ đó (`?tab=vault`) — mở hồ sơ
                          rồi bắt tự tìm tab là thêm một bước ở đúng chỗ đang vội. */}
                      <Link to={`${PATHS.device(item.id)}?tab=vault`}>
                        <span className="mono">{item.code}</span> <small>{item.name}</small>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {softwareHits.length > 0 ? (
              <div>
                <h3 className="form-section-title">{t('vaultHome.software')}</h3>
                <ul className="vault-hit-list">
                  {softwareHits.map((item) => (
                    <li key={item.id}>
                      <Link to={`${PATHS.softwareItem(item.id)}?tab=vault`}>
                        <span className="mono">{item.code}</span> <small>{item.name}</small>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </section>

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
