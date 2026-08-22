import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { formatDateTime, orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { Dialog, DialogTitle } from '@/ui/dialog';
import { FilterBar } from '@/ui/filter-bar';
import { LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { Pagination } from '@/ui/pagination';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';
import { AccountForm } from '@/features/admin/account-form';

interface AccountRow {
  id: string;
  email: string;
  fullName: string;
  role: Me['role'];
  status: 'active' | 'locked' | 'disabled';
  totpEnrolledAt: string | null;
  totpLoginRequired: boolean;
  lastLoginAt: string | null;
}

interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
}

const LIMIT = 20;

/** Story 1.4 — SA quản trị tài khoản và phiên. */
export function AccountsScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [sessionsFor, setSessionsFor] = useState<AccountRow | null>(null);

  // Tìm kiếm chạy PHÍA SERVER: lọc phía client chỉ lọc đúng 20 dòng đang xem, nên tên nằm ở
  // trang 3 sẽ ra bảng rỗng trong khi phân trang vẫn báo tổng 137 dòng.
  const accounts = useQuery({
    queryKey: ['accounts', page, search],
    queryFn: () =>
      apiFetch<{ items: AccountRow[]; total: number }>(
        `/api/v1/accounts?page=${page}&limit=${LIMIT}${
          search ? `&search=${encodeURIComponent(search)}` : ''
        }`,
        { credentials: 'include' },
      ),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['accounts'] });
  const csrfToken = me.csrfToken;

  // `id` nằm ở ĐƯỜNG DẪN, không được lọt vào body: ValidationPipe bật forbidNonWhitelisted
  // nên body thừa field là 400 "property id should not exist".
  const setStatus = useApiMutation<{ id: string; status: string }, unknown>(
    (input) => `/api/v1/accounts/${input.id}/status`,
    {
      method: 'PATCH',
      csrfToken,
      refreshMe: false,
      body: (input) => ({ status: input.status }),
    },
  );
  // Các endpoint dưới đây không nhận body — gửi `undefined` thay vì nhét `{id}` vào thân request.
  const resetPassword = useApiMutation<{ id: string }, { temporaryPassword: string }>(
    (input) => `/api/v1/accounts/${input.id}/reset-password`,
    { csrfToken, refreshMe: false, body: () => undefined },
  );
  const resetTotp = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/accounts/${input.id}/reset-totp`,
    { csrfToken, refreshMe: false, body: () => undefined },
  );

  const rows = accounts.data?.items ?? [];

  return (
    <>
      <PageHeader
        title={t('accounts.title')}
        subtitle={t('accounts.subtitle')}
        actions={
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>
            {t('accounts.create')}
          </button>
        }
      />

      <FilterBar
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1); // đổi từ khóa mà giữ nguyên trang 5 thì kết quả trông như rỗng
        }}
        searchPlaceholder={`${t('common.search')} theo tên hoặc email`}
      />

      {accounts.isLoading ? (
        <Loading />
      ) : accounts.isError ? (
        <LoadError onRetry={() => void accounts.refetch()} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('accounts.fullName')}</th>
                  <th>{t('accounts.role')}</th>
                  <th>{t('accounts.status')}</th>
                  <th>{t('accounts.totpEnrolled')}</th>
                  <th>{t('accounts.lastLogin')}</th>
                  <th className="col-center">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted" style={{ textAlign: 'center' }}>
                      {t('common.empty')}
                    </td>
                  </tr>
                ) : null}
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.fullName}
                      <span className="cell-sub">{row.email}</span>
                    </td>
                    <td>
                      <span className="badge plain brand">{roleLabel(row.role, t)}</span>
                    </td>
                    <td>
                      <span className={`badge ${row.status === 'active' ? 'ok' : 'danger'}`}>
                        {t(
                          row.status === 'active'
                            ? 'accounts.statusActive'
                            : row.status === 'locked'
                              ? 'accounts.statusLocked'
                              : 'accounts.statusDisabled',
                        )}
                      </span>
                    </td>
                    <td>
                      {row.totpEnrolledAt ? (
                        <span className="badge ok">{t('common.yes')}</span>
                      ) : (
                        <span className="badge warn">{t('common.no')}</span>
                      )}
                    </td>
                    <td>{orDash(row.lastLoginAt ? formatDateTime(row.lastLoginAt) : null)}</td>
                    <td>
                      <div className="action-cell">
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => setSessionsFor(row)}
                        >
                          {t('accounts.sessions')}
                        </button>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => {
                            void (async () => {
                              const ok = await askConfirm({
                                message: t('accounts.confirmResetPassword', { name: row.fullName }),
                                danger: true,
                              });
                              if (!ok) return;
                              resetPassword.mutate(
                                { id: row.id },
                                {
                                  onSuccess: (result) => {
                                    setTemporaryPassword(result.temporaryPassword);
                                    void refresh();
                                  },
                                  onError: (err) =>
                                    toast({ message: errorMessage(err), tone: 'error' }),
                                },
                              );
                            })();
                          }}
                        >
                          {t('accounts.resetPassword')}
                        </button>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => {
                            void (async () => {
                              const ok = await askConfirm({
                                message: t('accounts.confirmResetTotp', { name: row.fullName }),
                                danger: true,
                              });
                              if (!ok) return;
                              resetTotp.mutate(
                                { id: row.id },
                                {
                                  onSuccess: () => {
                                    toast({ message: 'Đã đặt lại xác thực 2 lớp.' });
                                    void refresh();
                                  },
                                  onError: (err) =>
                                    toast({ message: errorMessage(err), tone: 'error' }),
                                },
                              );
                            })();
                          }}
                        >
                          {t('accounts.resetTotp')}
                        </button>
                        <button
                          type="button"
                          className={`btn sm${row.status === 'active' ? ' danger' : ''}`}
                          onClick={() => {
                            void (async () => {
                              const next = row.status === 'active' ? 'locked' : 'active';
                              if (next === 'locked') {
                                const ok = await askConfirm({
                                  message: t('accounts.confirmLock', { name: row.fullName }),
                                  danger: true,
                                });
                                if (!ok) return;
                              }
                              setStatus.mutate(
                                { id: row.id, status: next },
                                {
                                  onSuccess: () => void refresh(),
                                  onError: (err) =>
                                    toast({ message: errorMessage(err), tone: 'error' }),
                                },
                              );
                            })();
                          }}
                        >
                          {row.status === 'active' ? t('accounts.lock') : t('accounts.unlock')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            limit={LIMIT}
            total={accounts.data?.total ?? 0}
            onPageChange={setPage}
          />
        </>
      )}

      {creating ? (
        <AccountForm
          csrfToken={csrfToken}
          onClose={() => setCreating(false)}
          onCreated={(password) => {
            setCreating(false);
            setTemporaryPassword(password);
            void refresh();
          }}
        />
      ) : null}

      {temporaryPassword ? (
        <Dialog open onOpenChange={() => setTemporaryPassword(null)} maxWidth={460}>
          <DialogTitle>{t('accounts.temporaryPassword')}</DialogTitle>
          <p className="mono temp-password">{temporaryPassword}</p>
          <p className="muted">{t('accounts.temporaryPasswordNote')}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn primary" onClick={() => setTemporaryPassword(null)}>
              {t('common.close')}
            </button>
          </div>
        </Dialog>
      ) : null}

      {sessionsFor ? (
        <SessionsDialog
          account={sessionsFor}
          csrfToken={csrfToken}
          onClose={() => setSessionsFor(null)}
        />
      ) : null}
    </>
  );
}

function SessionsDialog({
  account,
  csrfToken,
  onClose,
}: {
  account: AccountRow;
  csrfToken: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const sessions = useQuery({
    queryKey: ['accounts', account.id, 'sessions'],
    queryFn: () =>
      apiFetch<SessionRow[]>(`/api/v1/accounts/${account.id}/sessions`, {
        credentials: 'include',
      }),
  });
  const kill = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/accounts/sessions/${input.id}/kill`,
    { csrfToken, refreshMe: false, body: () => undefined },
  );

  return (
    <Dialog open onOpenChange={onClose} maxWidth={640}>
      <DialogTitle>
        {t('accounts.sessions')} — {account.fullName}
      </DialogTitle>
      {sessions.isLoading ? (
        <Loading />
      ) : (sessions.data ?? []).length === 0 ? (
        <p className="muted">{t('common.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>IP</th>
                <th>Trình duyệt</th>
                <th>Hoạt động gần nhất</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(sessions.data ?? []).map((session) => (
                <tr key={session.id}>
                  <td className="mono">{orDash(session.ip)}</td>
                  <td>
                    <span className="cell-sub">{orDash(session.userAgent?.slice(0, 60))}</span>
                  </td>
                  <td>{formatDateTime(session.lastSeenAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn sm danger"
                      onClick={() => {
                        void (async () => {
                          if (!(await askConfirm({ message: t('accounts.confirmKillSession'), danger: true })))
                            return;
                          kill.mutate(
                            { id: session.id },
                            {
                              onSuccess: () => {
                                toast({ message: 'Đã đá phiên.' });
                                void sessions.refetch();
                              },
                              onError: (err) => toast({ message: errorMessage(err), tone: 'error' }),
                            },
                          );
                        })();
                      }}
                    >
                      {t('accounts.killSession')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}

function roleLabel(role: Me['role'], t: (key: string) => string): string {
  return t(
    role === 'sa' ? 'accounts.roleSa' : role === 'admin' ? 'accounts.roleAdmin' : 'accounts.roleMember',
  );
}
