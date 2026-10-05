import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { PATHS } from '@/lib/routes';
import { Dialog } from '@/ui/dialog';
import { LoadError } from '@/ui/load-state';
import type { AccountRef } from './account-dialogs';
import { AccountFootprint } from './account-footprint';

/** Máy đã biết của một tài khoản — nhãn trình duyệt + mốc, không dấu vân tay máy. */
interface KnownDevice {
  id: string;
  label: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface AccountLockout {
  ip: string;
  failedAttempts: number;
  /** `null` = đang đếm sai nhưng chưa (hoặc không còn) bị chặn. */
  lockedUntil: string | null;
  updatedAt: string;
}

/**
 * Chi tiết MỘT tài khoản trong một hộp: ai, vai gì, 2 lớp, đăng nhập cuối, đang bị chặn từ IP
 * nào, còn giữ những gì, và lối sang phiên / nhật ký. Trả lời "người này đang thế nào" mà không
 * phải mở bốn năm chỗ.
 *
 * Phần hồ sơ (`facts`) do màn danh sách dựng sẵn — cùng hàm vẽ badge với bảng, để hai chỗ không
 * nói khác nhau. Hộp chỉ tự hỏi thêm hai thứ bảng không có: tạm chặn theo IP và "còn giữ".
 */
export function AccountDetailDialog({
  account,
  facts,
  onClose,
  onOpenSessions,
  onClearLockout,
  onEdit,
  vaultAccessPath,
}: {
  account: AccountRef;
  facts: { label: string; value: ReactNode }[];
  onClose: () => void;
  onOpenSessions: () => void;
  /**
   * Gỡ tạm chặn (hỏi lại + step-up ở màn danh sách). Chỉ truyền cho tài khoản ĐANG HOẠT ĐỘNG:
   * gỡ chặn chạy qua "cho vào lại", nên với tài khoản đang Khóa nó sẽ mở luôn cái khóa của SA.
   */
  onClearLockout?: () => void;
  onEdit: () => void;
  /** Chỉ Thành viên có dòng quyền két (SA/Admin xem theo vai) — có thì hiện link ở "Xem thêm". */
  vaultAccessPath?: string;
}) {
  const { t } = useTranslation();
  const lockouts = useQuery({
    queryKey: ['accounts', account.id, 'lockouts'],
    queryFn: () => apiFetch<AccountLockout[]>(`/api/v1/accounts/${account.id}/lockouts`),
  });
  const rows = lockouts.data ?? [];
  /* Máy đã biết (X-04, chỉ đọc): bảng quyết định có gửi thư "đăng nhập từ máy mới" không. */
  const known = useQuery({
    queryKey: ['accounts', account.id, 'known-devices'],
    queryFn: () => apiFetch<KnownDevice[]>(`/api/v1/accounts/${account.id}/known-devices`),
  });
  const blocked = rows.some((row) => row.lockedUntil !== null);

  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={640}
      initialFocus="title"
      title={account.fullName}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
          <button type="button" className="btn primary" onClick={onEdit}>
            {t('common.edit')}
          </button>
        </>
      }
    >
      <dl className="audit-detail">
        {facts.map((fact) => (
          <div key={fact.label} className="audit-detail-row">
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="account-lockouts" className="account-detail-block">
        <h3 id="account-lockouts" className="lbl-t">
          {t('accounts.lockoutsTitle')}
        </h3>
        {lockouts.isLoading ? (
          <p className="muted">{t('common.loading')}</p>
        ) : lockouts.isError ? (
          <LoadError error={lockouts.error} onRetry={() => void lockouts.refetch()} />
        ) : rows.length === 0 ? (
          <p className="muted">{t('accounts.lockoutsNone')}</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('accounts.lockoutIp')}</th>
                    <th>{t('accounts.lockoutAttempts')}</th>
                    <th>{t('accounts.lockoutUntil')}</th>
                    <th>{t('accounts.lockoutLastFail')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.ip}>
                      <td className="mono">{row.ip}</td>
                      <td>{row.failedAttempts}</td>
                      <td>
                        {row.lockedUntil ? (
                          <span className="badge warn">{formatDateTime(row.lockedUntil)}</span>
                        ) : (
                          <span className="muted">{t('accounts.lockoutNotBlocked')}</span>
                        )}
                      </td>
                      <td>{formatDateTime(row.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {blocked && onClearLockout ? (
              <button type="button" className="btn sm" onClick={onClearLockout}>
                {t('accounts.clearLockout')}
              </button>
            ) : null}
          </>
        )}
      </section>

      <section aria-labelledby="account-known-devices" className="account-detail-block">
        <h3 id="account-known-devices" className="lbl-t">
          {t('accounts.knownDevicesTitle')}
        </h3>
        {known.isLoading ? (
          <p className="muted">{t('common.loading')}</p>
        ) : known.isError ? (
          <LoadError error={known.error} onRetry={() => void known.refetch()} />
        ) : (known.data ?? []).length === 0 ? (
          <p className="muted">{t('accounts.knownDevicesNone')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('accounts.knownDeviceLabel')}</th>
                  <th>{t('accounts.knownDeviceFirst')}</th>
                  <th>{t('accounts.knownDeviceLast')}</th>
                </tr>
              </thead>
              <tbody>
                {(known.data ?? []).map((row) => (
                  <tr key={row.id}>
                    <td>{row.label ?? t('accounts.knownDeviceUnnamed')}</td>
                    <td>{formatDateTime(row.firstSeenAt)}</td>
                    <td>{formatDateTime(row.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="account-footprint" className="account-detail-block">
        <h3 id="account-footprint" className="lbl-t">
          {t('accounts.footprintTitle')}
        </h3>
        <AccountFootprint account={account} />
      </section>

      <section aria-labelledby="account-go" className="account-detail-block">
        <h3 id="account-go" className="lbl-t">
          {t('accounts.goTitle')}
        </h3>
        <div className="chip-row">
          <button type="button" className="btn sm" onClick={onOpenSessions}>
            {t('accounts.sessions')}
          </button>
          <Link className="linkbtn sm" to={`${PATHS.adminAuditLog}?q=${encodeURIComponent(account.email)}`}>
            {t('accounts.auditBy')}
          </Link>
          <Link
            className="linkbtn sm"
            to={`${PATHS.adminAuditLog}?objectId=${encodeURIComponent(account.id)}`}
          >
            {t('accounts.auditAbout')}
          </Link>
          {vaultAccessPath ? (
            <Link className="linkbtn sm" to={vaultAccessPath}>
              {t('accounts.vaultAccess')}
            </Link>
          ) : null}
        </div>
      </section>
    </Dialog>
  );
}
