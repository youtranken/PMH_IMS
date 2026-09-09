import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { formatDateTime, orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { sortQuery } from '@/lib/sort-query';
import { DataTable } from '@/ui/data-table';
import { Dialog } from '@/ui/dialog';
import { FilterBar } from '@/ui/filter-bar';
import { LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { Pagination } from '@/ui/pagination';
import { RowActions } from '@/ui/row-actions';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';
import { AccountForm } from './account-form';

interface AccountRow {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  employeeCode: string | null;
  birthDate: string | null;
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

const DEFAULT_LIMIT = 20;

/** Story 1.4 — SA quản trị tài khoản và phiên. */
export function AccountsScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  /** Số dòng/trang do NGƯỜI DÙNG chọn (10/20/50/100), không còn là hằng số cứng. */
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [search, setSearch] = useState('');
  // Sắp xếp chạy ở SERVER (`manualSorting`): danh sách phân trang 20 dòng/trang, sắp ở client
  // chỉ đảo chỗ 20 dòng đang xem mà trông như đã sắp cả bảng — sai mà không có dấu hiệu nào.
  const [sorting, setSorting] = useState<SortingState>([{ id: 'fullName', desc: false }]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [sessionsFor, setSessionsFor] = useState<AccountRow | null>(null);

  // Tìm kiếm chạy PHÍA SERVER: lọc phía client chỉ lọc đúng 20 dòng đang xem, nên tên nằm ở
  // trang 3 sẽ ra bảng rỗng trong khi phân trang vẫn báo tổng 137 dòng.
  const accounts = useQuery({
    queryKey: ['accounts', page, limit, search, sorting],
    queryFn: () =>
      apiFetch<{ items: AccountRow[]; total: number }>(
        `/api/v1/accounts?${[
          `page=${page}`,
          `limit=${limit}`,
          search ? `search=${encodeURIComponent(search)}` : '',
          sortQuery(sorting),
        ]
          .filter(Boolean)
          .join('&')}`,
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

  /**
   * `accessorKey` PHẢI khớp whitelist `USER_SORT_KEYS` phía API — đó là tên cột gửi lên trong
   * `?sort=`. `email` không có cột riêng (chỉ là dòng phụ dưới Họ tên) nên không sắp được.
   */
  const columns = useMemo<ColumnDef<AccountRow, unknown>[]>(
    () => [
      {
        accessorKey: 'fullName',
        header: t('accounts.fullName'),
        cell: ({ row }) => (
          <>
            {row.original.fullName}
            {/* Mã nhân viên đi cùng tên vì đó là cách Nhân sự gọi một người; email và SĐT
                xuống dòng nhỏ. Không tách thành hai cột nữa — bảng đã 6 cột, thêm hai cột
                ngắn là bắt cuộn ngang để đọc một con số. */}
            {row.original.employeeCode ? (
              <span className="mono"> · {row.original.employeeCode}</span>
            ) : null}
            <span className="cell-sub">
              {row.original.email}
              {row.original.phone ? ` · ${row.original.phone}` : ''}
            </span>
          </>
        ),
      },
      {
        accessorKey: 'role',
        header: t('accounts.role'),
        cell: ({ row }) => (
          <span className="badge plain brand">{roleLabel(row.original.role, t)}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: t('accounts.status'),
        cell: ({ row }) => (
          <span className={`badge ${row.original.status === 'active' ? 'ok' : 'danger'}`}>
            {t(
              row.original.status === 'active'
                ? 'accounts.statusActive'
                : row.original.status === 'locked'
                  ? 'accounts.statusLocked'
                  : 'accounts.statusDisabled',
            )}
          </span>
        ),
      },
      {
        accessorKey: 'totpEnrolledAt',
        header: t('accounts.totpEnrolled'),
        cell: ({ row }) =>
          row.original.totpEnrolledAt ? (
            <span className="badge ok">{t('common.yes')}</span>
          ) : (
            <span className="badge warn">{t('common.no')}</span>
          ),
      },
      {
        accessorKey: 'lastLoginAt',
        header: t('accounts.lastLogin'),
        cell: ({ row }) =>
          orDash(row.original.lastLoginAt ? formatDateTime(row.original.lastLoginAt) : null),
      },
      {
        id: 'actions',
        header: t('common.actions'),
        meta: { className: 'col-center' },
        cell: ({ row }) => {
          const account = row.original;
          const rowBusy = setStatus.isPending || resetPassword.isPending || resetTotp.isPending;
          const locking = account.status === 'active';
          return (
            <div className="action-cell">
              {/*
                Năm việc trên một dòng — nhiều nhất trong cả hệ thống. Dãy nút phẳng ở đây làm
                cột thao tác rộng hơn cả năm cột dữ liệu cộng lại, và bốn trong năm cái là việc
                vài tháng mới làm một lần (đặt lại mật khẩu, đặt lại 2FA, khóa tài khoản).
              */}
              <RowActions
                label={t('common.actionsOf', { subject: account.fullName })}
                items={[
                  /* Sửa hồ sơ (tên · SĐT · mã NV) ngay trên danh sách, cùng nếp với màn Thiết
                     bị và Phần mềm — đổi một số điện thoại là việc lặt vặt hằng ngày. */
                  {
                    key: 'edit',
                    label: t('common.edit'),
                    disabled: rowBusy,
                    onSelect: () => setEditing(account),
                  },
                  {
                    key: 'sessions',
                    label: t('accounts.sessions'),
                    disabled: rowBusy,
                    onSelect: () => setSessionsFor(account),
                  },
                  {
                    key: 'reset-password',
                    label: t('accounts.resetPassword'),
                    danger: true,
                    disabled: resetPassword.isPending,
                    onSelect: () => {
                      void (async () => {
                        const ok = await askConfirm({
                          message: t('accounts.confirmResetPassword', {
                            name: account.fullName,
                          }),
                          danger: true,
                          confirmLabel: t('accounts.resetPassword'),
                        });
                        if (!ok) return;
                        resetPassword.mutate(
                          { id: account.id },
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
                    },
                  },
                  {
                    key: 'reset-totp',
                    label: t('accounts.resetTotp'),
                    danger: true,
                    disabled: resetTotp.isPending,
                    onSelect: () => {
                      void (async () => {
                        const ok = await askConfirm({
                          message: t('accounts.confirmResetTotp', { name: account.fullName }),
                          danger: true,
                          confirmLabel: t('accounts.resetTotp'),
                        });
                        if (!ok) return;
                        resetTotp.mutate(
                          { id: account.id },
                          {
                            onSuccess: () => {
                              toast({ message: t('accounts.totpReset') });
                              void refresh();
                            },
                            onError: (err) =>
                              toast({ message: errorMessage(err), tone: 'error' }),
                          },
                        );
                      })();
                    },
                  },
                  {
                    key: 'lock',
                    label: locking ? t('accounts.lock') : t('accounts.unlock'),
                    /* Khóa là lấy đi (người ta không đăng nhập được nữa); mở khóa thì không. */
                    danger: locking,
                    disabled: setStatus.isPending,
                    onSelect: () => {
                      void (async () => {
                        if (locking) {
                          const ok = await askConfirm({
                            message: t('accounts.confirmLock', { name: account.fullName }),
                            danger: true,
                            confirmLabel: t('accounts.lock'),
                          });
                          if (!ok) return;
                        }
                        setStatus.mutate(
                          { id: account.id, status: locking ? 'locked' : 'active' },
                          {
                            onSuccess: () => void refresh(),
                            onError: (err) =>
                              toast({ message: errorMessage(err), tone: 'error' }),
                          },
                        );
                      })();
                    },
                  },
                ]}
              />
            </div>
          );
        },
      },
    ],
    [t, setStatus.isPending, resetPassword.isPending, resetTotp.isPending],
  );

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
          <DataTable
            data={rows}
            columns={columns}
            emptyText={t('common.empty')}
            stackOnMobile
            manualSorting
            sorting={sorting}
            onSortingChange={(updater) => {
              setSorting((current) =>
                typeof updater === 'function' ? updater(current) : updater,
              );
              // Đổi cột sắp xếp thì về trang 1: giữ nguyên trang 5 của thứ tự CŨ là nhìn vào
              // một lát cắt chẳng liên quan gì tới thứ tự vừa chọn.
              setPage(1);
            }}
          />

          <Pagination
            page={page}
            limit={limit}
            onLimitChange={setLimit}
            total={accounts.data?.total ?? 0}
            onPageChange={setPage}
          />
        </>
      )}

      {creating ? (
        <AccountForm
          account={null}
          csrfToken={csrfToken}
          onClose={() => setCreating(false)}
          onCreated={(password) => {
            setCreating(false);
            setTemporaryPassword(password);
            void refresh();
          }}
          onSaved={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <AccountForm
          account={editing}
          csrfToken={csrfToken}
          onClose={() => setEditing(null)}
          onCreated={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast({ message: t('accounts.profileSaved') });
            void refresh();
          }}
        />
      ) : null}

      {temporaryPassword ? (
        <Dialog
          open
          onOpenChange={() => setTemporaryPassword(null)}
          maxWidth={460}
          title={t('accounts.temporaryPassword')}
          footer={
            <button type="button" className="btn primary" onClick={() => setTemporaryPassword(null)}>
              {t('common.close')}
            </button>
          }
        >
          <p className="mono temp-password" data-testid="temp-password">{temporaryPassword}</p>
          <p className="muted">{t('accounts.temporaryPasswordNote')}</p>
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
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={640}
      title={`${t('accounts.sessions')} — ${account.fullName}`}
    >
      {sessions.isLoading ? (
        <Loading />
      ) : sessions.isError ? (
        /*
         * "KHÔNG CÒN PHIÊN NÀO" LÀ CÂU TRẢ LỜI CỦA MÀN NÀY — nên nó không được nói ra khi
         * chưa hỏi được.
         *
         * Bản trước chỉ có `isLoading` và `?? []`: API 500 rơi thẳng vào nhánh rỗng và hộp
         * thoại hiện "Chưa có dữ liệu". Đây là màn người ta mở đúng lúc nghi một tài khoản
         * bị chiếm — đọc "không còn phiên nào" rồi đóng lại là để nguyên phiên của kẻ đang
         * đăng nhập, và tin rằng mình đã kiểm tra xong.
         */
        <LoadError onRetry={() => void sessions.refetch()} />
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
                          if (
                            !(await askConfirm({
                              message: t('accounts.confirmKillSession'),
                              danger: true,
                              confirmLabel: t('accounts.killSession'),
                            }))
                          )
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
