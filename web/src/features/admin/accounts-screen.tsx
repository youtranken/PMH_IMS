import { useCallback, useMemo, useState } from 'react';
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

type AccountStatus = AccountRow['status'];

/**
 * BA trạng thái tài khoản, và việc đổi trạng thái hợp lệ ở từng trạng thái.
 *
 * ===== VÌ SAO LÀ BẢNG CHỨ KHÔNG PHẢI `if` =====
 *
 * Bản trước hỏi đúng một câu — `status === 'active'` — rồi chia đôi: hoạt động thì hiện
 * "Khóa", CÒN LẠI thì hiện "Mở khóa". Nghĩa là một tài khoản đang **vô hiệu hóa** cũng được
 * mời "Mở khóa", trong khi nó có bị khóa đâu.
 *
 * Câu chữ ấy không phải chuyện nhỏ: `auth.service.ts` cố ý trả HAI mã lỗi khác nhau
 * (`ACCOUNT_LOCKED` / `ACCOUNT_DISABLED`) đúng vì khóa là tạm còn vô hiệu hóa là cho người đã
 * nghỉ hẳn — người trực cần biết nên bảo người dùng chờ hay bảo họ gặp SA. Rồi màn quản trị
 * gộp cả hai lại làm một cái nút.
 *
 * Kèm theo: `accounts.disable` là khóa dịch CHẾT — API nhận `disabled` từ lâu (`StatusDto`,
 * có `assertNotLastSa` canh), nhưng giao diện không có đường nào đi tới, nên trạng thái thứ
 * ba chỉ đặt được bằng `curl`. Bảng này mở đường đó ra.
 *
 * `Record<AccountStatus, …>` nên thêm trạng thái thứ tư là lỗi BIÊN DỊCH, không phải một
 * dòng menu ghi nhầm việc.
 */
interface StatusAction {
  key: string;
  /** Khóa i18n của nhãn menu — dùng lại làm nhãn nút xác nhận, để hai chỗ không nói khác nhau. */
  label: string;
  /** Trạng thái sẽ ghi xuống. */
  to: AccountStatus;
  danger: boolean;
  /** Khóa i18n của câu hỏi lại. `null` = không hỏi — việc TRẢ lại quyền thì không cần rào. */
  confirm: string | null;
}

const STATUS_ACTIONS: Record<AccountStatus, StatusAction[]> = {
  active: [
    { key: 'lock', label: 'accounts.lock', to: 'locked', danger: true, confirm: 'accounts.confirmLock' },
    {
      key: 'disable',
      label: 'accounts.disable',
      to: 'disabled',
      danger: true,
      confirm: 'accounts.confirmDisable',
    },
  ],
  locked: [
    { key: 'unlock', label: 'accounts.unlock', to: 'active', danger: false, confirm: null },
    {
      key: 'disable',
      label: 'accounts.disable',
      to: 'disabled',
      danger: true,
      confirm: 'accounts.confirmDisable',
    },
  ],
  /* Bật lại một tài khoản đã cho nghỉ thì PHẢI hỏi: nó khác hẳn mở một cái khóa tạm. */
  disabled: [
    {
      key: 'reactivate',
      label: 'accounts.reactivate',
      to: 'active',
      danger: false,
      confirm: 'accounts.confirmReactivate',
    },
  ],
};

const STATUS_LABEL: Record<AccountStatus, string> = {
  active: 'accounts.statusActive',
  locked: 'accounts.statusLocked',
  disabled: 'accounts.statusDisabled',
};

/** Khóa là tạm (`warn`), vô hiệu hóa là dứt (`danger`) — bản cũ tô cả hai cùng một màu đỏ. */
const STATUS_TONE: Record<AccountStatus, string> = {
  active: 'ok',
  locked: 'warn',
  disabled: 'danger',
};

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
  /* Giữ kèm CHỦ của mật khẩu: mở từ dòng thứ sáu trong bảng thì không ai nhớ đang reset cho ai. */
  const [temporaryPassword, setTemporaryPassword] = useState<{ password: string; who: string } | null>(
    null,
  );
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

  // `useCallback` vì `refresh` nằm trong deps của `columns`: hàm mới mỗi render sẽ làm
  // memo tính lại mỗi render, tức vô hiệu hoá chính nó. `queryClient` bền tham chiếu.
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['accounts'] }),
    [queryClient],
  );
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
          <span className={`badge ${STATUS_TONE[row.original.status]}`}>
            {t(STATUS_LABEL[row.original.status])}
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
        /* `col-right` = KHÔNG gãy dòng (table.css). Mốc "17/09/2026 14:03" mà rơi xuống hai
           dòng thì mọi hàng của bảng cao gấp đôi vì đúng một cột — và đây là bảng có tới ba
           cột huy hiệu ngắn ngủn bên cạnh, tức luôn có chỗ để nó nằm gọn một dòng. */
        meta: { className: 'col-right' },
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
                          title: t('common.titleOf', {
                            action: t('accounts.resetPassword'),
                            subject: account.fullName,
                          }),
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
                              setTemporaryPassword({
                                password: result.temporaryPassword,
                                who: account.email,
                              });
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
                          title: t('common.titleOf', {
                            action: t('accounts.resetTotp'),
                            subject: account.fullName,
                          }),
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
                  ...STATUS_ACTIONS[account.status].map((action) => ({
                    key: action.key,
                    label: t(action.label),
                    /* Việc LẤY ĐI quyền (khóa, vô hiệu hóa) mới đỏ; trả lại thì không. */
                    danger: action.danger,
                    disabled: setStatus.isPending,
                    onSelect: () => {
                      void (async () => {
                        if (action.confirm) {
                          const ok = await askConfirm({
                            title: t('common.titleOf', {
                              action: t(action.label),
                              subject: account.fullName,
                            }),
                            message: t(action.confirm, { name: account.fullName }),
                            danger: action.danger,
                            confirmLabel: t(action.label),
                          });
                          if (!ok) return;
                        }
                        setStatus.mutate(
                          { id: account.id, status: action.to },
                          {
                            onSuccess: () => void refresh(),
                            onError: (err) =>
                              toast({ message: errorMessage(err), tone: 'error' }),
                          },
                        );
                      })();
                    },
                  })),
                ]}
              />
            </div>
          );
        },
      },
    ],
    /*
     * DEP LÀ GIÁ TRỊ ĐƯỢC DÙNG, KHÔNG PHẢI CẢ ĐỐI TƯỢNG MUTATION (§18 #2, sửa 22/09).
     *
     * Chú thích cũ viết: *"`.mutate` của TanStack v5 ổn định, nên memo không vì thế mà tính
     * lại thêm lần nào"*. Câu ấy đúng về `.mutate` và SAI về thứ thật sự nằm trong deps —
     * đó là cả `setStatus` / `resetPassword` / `resetTotp`, tức ĐỐI TƯỢNG mutation, và
     * TanStack dựng lại chúng sau mỗi lần render.
     *
     * Nên `columns` tính lại ở MỌI lượt render, và `useMemo` ở đây chỉ còn là trang trí —
     * đúng cái bẫy mà cùng lượt sửa 20/09 đang vá cho `kindLabel` và `refresh`. Chú thích mô
     * tả đúng ý định và sai về hệ quả, lần thứ tư trong đợt rà soát này.
     *
     * Nay khai đúng hai thứ đang dùng: `.mutate` (bền theo hợp đồng của v5) và `.isPending`
     * (một boolean). Memo tính lại khi một cờ chờ lật — đúng lúc cần, và chỉ lúc đó.
     */
    /*
     * `exhaustive-deps` muốn CẢ ĐỐI TƯỢNG mutation ở đây, và làm theo nó là dựng lại đúng lỗi
     * vừa vá: đối tượng ấy được TanStack tạo mới sau mỗi render, nên memo tính lại mọi lượt.
     *
     * Luật không đọc được "hai thuộc tính này là tất cả những gì tôi dùng" — `.mutate` bền
     * theo hợp đồng của v5, `.isPending` là boolean. Tắt đúng một dòng, và nói ra cái giá:
     * thêm một thuộc tính mới của ba mutation này vào thân memo thì phải tự nhớ khai xuống
     * dưới. Đó là lý do danh sách dưới đây liệt kê từng thuộc tính chứ không gộp.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      t,
      setStatus.mutate,
      setStatus.isPending,
      resetPassword.mutate,
      resetPassword.isPending,
      resetTotp.mutate,
      resetTotp.isPending,
      askConfirm,
      refresh,
      toast,
    ],
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
        <LoadError error={accounts.error} onRetry={() => void accounts.refetch()} />
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
          onCreated={(password, email) => {
            setCreating(false);
            setTemporaryPassword({ password, who: email });
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
          /*
           * KHÔNG cho đóng bằng Esc hay bấm ra nền (rà UI/UX 12/09).
           *
           * Chuỗi này chỉ tồn tại đúng một lần: API sinh ra, trả về, rồi quên. Mọi hộp khác
           * trong màn đóng dễ là đúng — đóng nhầm thì mở lại. Riêng hộp này đóng nhầm là
           * người dùng mới không đăng nhập được, SA phải đặt lại mật khẩu, và vòng đó lặp
           * cho tới khi có người đọc kịp.
           *
           * Chính câu chú thích bên trong hộp đã nói "sẽ không hiển thị lại" — nay hộp cư xử
           * đúng như lời nó nói.
           */
          requireExplicitClose
          title={t('accounts.temporaryPasswordOf', { who: temporaryPassword.who })}
          footer={
            <button type="button" className="btn primary" onClick={() => setTemporaryPassword(null)}>
              {t('accounts.temporaryPasswordDone')}
            </button>
          }
        >
          {/*
            CỐ Ý KHÔNG CÓ NÚT CHÉP, dù bôi đen chuỗi `mono` là thao tác dễ trượt.
            `ui/copy-button.tsx` đã chốt luật đó cho giá trị secret: clipboard sống qua cả
            phiên đăng nhập, dán nhầm vào ô chat là mất luôn. Mật khẩu tạm cũng là secret.
          */}
          <p className="mono temp-password" data-testid="temp-password">
            {temporaryPassword.password}
          </p>
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
        <LoadError error={sessions.error} onRetry={() => void sessions.refetch()} />
      ) : (sessions.data ?? []).length === 0 ? (
        /*
         * "Chưa có dữ liệu" là câu của một cái bảng trống. Màn NÀY người ta mở đúng lúc nghi
         * một tài khoản bị chiếm, nên câu trả lời phải là một KHẲNG ĐỊNH đọc được: không còn
         * phiên nào đang mở. Chữ chung chung ở đây để người đọc tự hiểu thành "chưa hỏi được".
         */
        <p className="muted">{t('accounts.noSessions')}</p>
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
                              /* Hộp che mất cái bảng, nên "phiên NÀY" không còn chỉ vào đâu
                                 cả. Nêu IP + lần hoạt động gần nhất: đó là hai thứ phân biệt
                                 phiên của chính mình với phiên của kẻ đang chiếm tài khoản. */
                              title: t('common.titleOf', {
                                action: t('accounts.killSession'),
                                subject: orDash(session.ip),
                              }),
                              message: t('accounts.confirmKillSession', {
                                ip: orDash(session.ip),
                                seen: formatDateTime(session.lastSeenAt),
                              }),
                              danger: true,
                              confirmLabel: t('accounts.killSession'),
                            }))
                          )
                            return;
                          kill.mutate(
                            { id: session.id },
                            {
                              onSuccess: () => {
                                toast({ message: t('accounts.sessionKilled') });
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
