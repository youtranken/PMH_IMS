import { useCallback, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { formatDateTime, orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { sortQuery } from '@/lib/sort-query';
import { DataTable } from '@/ui/data-table';
import { Dialog } from '@/ui/dialog';
import { FilterBar } from '@/ui/filter-bar';
import { useClampPage, useListUrlState } from '@/ui/use-list-url-state';
import { LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { Pagination } from '@/ui/pagination';
import { RowActions } from '@/ui/row-actions';
import { useConfirm } from '@/ui/confirm-provider';
import { CopyButton } from '@/ui/copy-button';
import { SessionList, type SessionItem } from '@/ui/session-list';
import { useStepUpRetry } from '@/ui/use-step-up-retry';
import { useToast } from '@/ui/toast';
import { PATHS } from '@/lib/routes';
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
  /**
   * Khóa i18n của câu hỏi lại. Mọi việc đổi trạng thái đều hỏi: kể cả Mở khóa — nút nằm sát
   * "Đặt lại mật khẩu" và "Vô hiệu hóa", bấm trượt trên điện thoại là mở lại một tài khoản
   * đang nghi bị chiếm.
   */
  confirm: string;
  /** Khóa i18n của toast sau khi xong — mọi lần đổi trạng thái đều phải có phản hồi. */
  done: string;
}

const STATUS_ACTIONS: Record<AccountStatus, StatusAction[]> = {
  active: [
    {
      key: 'lock',
      label: 'accounts.lock',
      to: 'locked',
      danger: true,
      confirm: 'accounts.confirmLock',
      done: 'accounts.toastLocked',
    },
    {
      key: 'disable',
      label: 'accounts.disable',
      to: 'disabled',
      danger: true,
      confirm: 'accounts.confirmDisable',
      done: 'accounts.toastDisabled',
    },
  ],
  locked: [
    {
      key: 'unlock',
      label: 'accounts.unlock',
      to: 'active',
      danger: false,
      confirm: 'accounts.confirmUnlock',
      done: 'accounts.toastUnlocked',
    },
    {
      key: 'disable',
      label: 'accounts.disable',
      to: 'disabled',
      danger: true,
      confirm: 'accounts.confirmDisable',
      done: 'accounts.toastDisabled',
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
      done: 'accounts.toastReactivated',
    },
  ],
};

/**
 * Cột "2 lớp" — BA trạng thái, vì trường hợp nguy hiểm là "bắt buộc mà chưa cài" (lần đăng
 * nhập tới sẽ bị đòi cài ngay) chứ không phải "không bắt buộc". Hai cờ riêng rẽ tô cùng màu
 * cam thì SA không phân biệt được hai cảnh đó.
 */
export function totpState(row: { totpEnrolledAt: string | null; totpLoginRequired: boolean }): {
  label: string;
  tone: 'ok' | 'warn' | 'muted';
} {
  if (row.totpEnrolledAt) return { label: 'accounts.totpStateEnrolled', tone: 'ok' };
  if (row.totpLoginRequired) return { label: 'accounts.totpStateMissing', tone: 'warn' };
  return { label: 'accounts.totpStateOptional', tone: 'muted' };
}

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

const DEFAULT_LIMIT = 20;

/** Story 1.4 — SA quản trị tài khoản và phiên. */
export function AccountsScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  /*
   * TRẠNG THÁI DANH SÁCH SỐNG TRÊN THANH ĐỊ CHỈ (B-02, 23/09).
   *
   * Đây là màn danh sách thứ bảy lên `useListUrlState`. Đo được trước khi sửa: gõ "Cao" thì bảng
   * còn 1 dòng nhưng URL không đổi; bấm sắp xếp, URL không đổi; reload thì về 7 dòng và ô tìm
   * trắng. Hệ quả không nằm ở tiện nghi: **không chia sẻ được link đã lọc**, và nút Back của
   * trình duyệt RỜI TRANG thay vì gỡ bộ lọc — sáu màn kia thì ngược lại, nên cùng một phản xạ
   * cho hai kết quả khác nhau.
   *
   * KHÔNG phải màn CUỐI CÙNG, dù dòng này trước 26/09 viết vậy: `catalog-screen.tsx` và
   * `disposal-screen.tsx` vẫn giữ ô tìm/bộ lọc trong `useState`. Hai màn ấy chưa chuyển vì lý
   * do riêng của chúng, nhưng viết "cuối cùng" ở đây làm người đọc tin rằng việc đã xong.
   *
   * Ô tìm cũng được debounce 250ms kèm theo — trước đây mỗi phím là một lượt gọi API.
   */
  const url = useListUrlState<{ search: string }>({
    emptyFilters: { search: '' },
    defaultLimit: DEFAULT_LIMIT,
    defaultSort: { key: 'fullName', desc: false },
    searchKey: 'search',
  });
  const { page, limit } = url;
  const search = url.search;
  const setPage = url.setPage;
  const setLimit = url.setLimit;
  // Sắp xếp chạy ở SERVER (`manualSorting`): danh sách phân trang 20 dòng/trang, sắp ở client
  // chỉ đảo chỗ 20 dòng đang xem mà trông như đã sắp cả bảng — sai mà không có dấu hiệu nào.
  const sorting: SortingState = [{ id: url.sorting.key, desc: url.sorting.desc }];
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  /*
   * Giữ kèm CHỦ của mật khẩu: mở từ dòng thứ sáu trong bảng thì không ai nhớ đang reset cho ai.
   * `created` chỉ có khi vừa TẠO tài khoản — lúc đó hộp hiện thêm các bước tiếp theo.
   */
  const [temporaryPassword, setTemporaryPassword] = useState<{
    password: string;
    who: string;
    created?: CreatedAccount;
  } | null>(null);
  const [sessionsFor, setSessionsFor] = useState<AccountRow | null>(null);
  /* Mọi lệnh ghi ở màn này đòi step-up (`@RequiresStepUp`): hết ân hạn thì hỏi mã rồi chạy lại. */
  const stepUp = useStepUpRetry(me.csrfToken);
  const runWithStepUp = stepUp.run;

  // Tìm kiếm chạy PHÍA SERVER: lọc phía client chỉ lọc đúng 20 dòng đang xem, nên tên nằm ở
  // trang 3 sẽ ra bảng rỗng trong khi phân trang vẫn báo tổng 137 dòng.
  const accounts = useQuery({
    queryKey: ['accounts', page, limit, search, sorting],
    // Đổi trang/từ khoá thì GIỮ bảng cũ tới khi có dữ liệu mới: vẽ lại Loading là gỡ cả bảng,
    // mất dòng đang bung/menu đang mở và bảng nháy trắng sau mỗi lần gõ tìm.
    placeholderData: keepPreviousData,
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
  useClampPage(url, accounts.data?.total);

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
  const setTotpRequired = useApiMutation<{ id: string; required: boolean }, unknown>(
    (input) => `/api/v1/accounts/${input.id}/totp-login-required`,
    {
      method: 'PATCH',
      csrfToken,
      refreshMe: false,
      body: (input) => ({ required: input.required }),
    },
  );

  /*
   * Hỏi lại → (step-up nếu cần) → toast. Một cửa cho mọi việc trên menu dòng, để không việc nào
   * lặng lẽ chạy mà không có phản hồi.
   */
  const confirmThenRun = useCallback(
    async (options: {
      title: string;
      message: string;
      danger: boolean;
      confirmLabel: string;
      run: () => Promise<unknown>;
      done?: string;
    }) => {
      const ok = await askConfirm({
        title: options.title,
        message: options.message,
        danger: options.danger,
        confirmLabel: options.confirmLabel,
      });
      if (!ok) return undefined;
      try {
        const result = await runWithStepUp(options.run);
        if (options.done) toast({ message: options.done });
        void refresh();
        return result;
      } catch (err) {
        // Người dùng tự đóng hộp hỏi mã = tự huỷ, không phải lỗi để báo.
        if (err instanceof Error && err.message === 'STEPUP_CANCELLED') return undefined;
        toast({ message: errorMessage(err), tone: 'error' });
        return undefined;
      }
    },
    [askConfirm, runWithStepUp, toast, refresh],
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
        header: t('accounts.totpColumn'),
        cell: ({ row }) => {
          const state = totpState(row.original);
          return <span className={`badge ${state.tone}`}>{t(state.label)}</span>;
        },
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
                Sáu việc trên một dòng — nhiều nhất trong cả hệ thống (bốn việc cố định cộng hai mục
                theo trạng thái; riêng `disabled` chỉ có một nên ra năm). Dãy nút phẳng ở đây làm
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
                        const result = await confirmThenRun({
                          title: t('common.titleOf', {
                            action: t('accounts.resetPassword'),
                            subject: account.fullName,
                          }),
                          message: t('accounts.confirmResetPassword', { name: account.fullName }),
                          danger: true,
                          confirmLabel: t('accounts.resetPassword'),
                          run: () => resetPassword.mutateAsync({ id: account.id }),
                        });
                        if (result) {
                          setTemporaryPassword({
                            password: (result as { temporaryPassword: string }).temporaryPassword,
                            who: account.email,
                          });
                        }
                      })();
                    },
                  },
                  {
                    key: 'reset-totp',
                    label: t('accounts.resetTotp'),
                    danger: true,
                    disabled: resetTotp.isPending,
                    onSelect: () =>
                      void confirmThenRun({
                        title: t('common.titleOf', {
                          action: t('accounts.resetTotp'),
                          subject: account.fullName,
                        }),
                        message: t('accounts.confirmResetTotp', { name: account.fullName }),
                        danger: true,
                        confirmLabel: t('accounts.resetTotp'),
                        run: () => resetTotp.mutateAsync({ id: account.id }),
                        done: t('accounts.totpReset'),
                      }),
                  },
                  /* Bật/tắt cưỡng chế 2 lớp lúc đăng nhập (NFR-01). TẮT là hạ rào nên tô đỏ;
                     bật lại thì không lấy đi gì của ai. */
                  {
                    key: 'totp-required',
                    label: t(
                      account.totpLoginRequired ? 'accounts.totpRequireOff' : 'accounts.totpRequireOn',
                    ),
                    danger: account.totpLoginRequired,
                    disabled: setTotpRequired.isPending,
                    onSelect: () => {
                      const required = !account.totpLoginRequired;
                      const label = t(required ? 'accounts.totpRequireOn' : 'accounts.totpRequireOff');
                      void confirmThenRun({
                        title: t('common.titleOf', { action: label, subject: account.fullName }),
                        message: t(
                          required ? 'accounts.confirmTotpRequireOn' : 'accounts.confirmTotpRequireOff',
                          { name: account.fullName },
                        ),
                        danger: !required,
                        confirmLabel: label,
                        run: () => setTotpRequired.mutateAsync({ id: account.id, required }),
                        done: t(
                          required ? 'accounts.toastTotpRequireOn' : 'accounts.toastTotpRequireOff',
                          { name: account.fullName },
                        ),
                      });
                    },
                  },
                  ...STATUS_ACTIONS[account.status].map((action) => ({
                    key: action.key,
                    label: t(action.label),
                    /* Việc LẤY ĐI quyền (khóa, vô hiệu hóa) mới đỏ; trả lại thì không. */
                    danger: action.danger,
                    disabled: setStatus.isPending,
                    onSelect: () =>
                      void confirmThenRun({
                        title: t('common.titleOf', {
                          action: t(action.label),
                          subject: account.fullName,
                        }),
                        message: t(action.confirm, { name: account.fullName }),
                        danger: action.danger,
                        confirmLabel: t(action.label),
                        run: () => setStatus.mutateAsync({ id: account.id, status: action.to }),
                        done: t(action.done, { name: account.fullName }),
                      }),
                  })),
                ]}
              />
            </div>
          );
        },
      },
    ],
    /*
     * Deps là THUỘC TÍNH được dùng, không phải cả đối tượng mutation: TanStack dựng lại đối
     * tượng ấy sau mỗi render, nên khai nó là memo tính lại mọi lượt. `.mutateAsync` bền theo
     * hợp đồng của v5, `.isPending` là boolean. `exhaustive-deps` không đọc được điều đó nên
     * tắt đúng một dòng — thêm thuộc tính mới vào thân memo thì phải tự khai xuống dưới.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      t,
      setStatus.mutateAsync,
      setStatus.isPending,
      resetPassword.mutateAsync,
      resetPassword.isPending,
      resetTotp.mutateAsync,
      resetTotp.isPending,
      setTotpRequired.mutateAsync,
      setTotpRequired.isPending,
      confirmThenRun,
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

      {/* Hook tự bỏ `page` khỏi URL khi ô tìm đổi: đổi từ khóa mà giữ nguyên trang 5 thì kết
          quả trông như rỗng. */}
      <FilterBar
        search={url.searchInput}
        onSearchChange={url.setSearchInput}
        searchPlaceholder={t('accounts.searchPlaceholder')}
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
            /*
             * Trước 23/09 đây là chỗ DUY NHẤT trong 14 chỗ còn dùng `common.empty` = "Chưa có
             * dữ liệu": gõ một từ không khớp là màn tuyên bố hệ thống chưa có tài khoản nào —
             * trên chính màn quản trị tài khoản, nơi câu đó đọc như một sự cố. Cùng lớp lỗi
             * với bốn màn danh sách vừa tách câu rỗng, và nay dùng được `isFiltered` của hook.
             */
            emptyText={url.isFiltered ? t('accounts.emptyFiltered') : t('accounts.empty')}
            stackOnMobile
            manualSorting
            sorting={sorting}
            onSortingChange={(updater) => {
              const next = typeof updater === 'function' ? updater(sorting) : updater;
              const first = next[0];
              // Đổi cột sắp xếp thì hook tự bỏ `page` khỏi URL: giữ nguyên trang 5 của thứ tự CŨ
              // là nhìn vào một lát cắt chẳng liên quan gì tới thứ tự vừa chọn.
              url.setSorting(
                first
                  ? { key: String(first.id), desc: !!first.desc }
                  : { key: 'fullName', desc: false },
              );
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
          onCreated={(password, created) => {
            setCreating(false);
            setTemporaryPassword({ password, who: created.email, created });
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
        <TemporaryPasswordDialog
          password={temporaryPassword.password}
          who={temporaryPassword.who}
          created={temporaryPassword.created}
          onClose={() => setTemporaryPassword(null)}
        />
      ) : null}

      {sessionsFor ? (
        <SessionsDialog
          account={sessionsFor}
          csrfToken={csrfToken}
          onClose={() => setSessionsFor(null)}
        />
      ) : null}

      {stepUp.dialog}
    </>
  );
}

/** Tài khoản vừa tạo — đủ để hộp mật khẩu tạm dẫn sang bước tiếp theo. */
export interface CreatedAccount {
  id: string;
  email: string;
  fullName: string;
  role: Me['role'];
}

/**
 * Hộp mật khẩu tạm — hiện MỘT LẦN, sau khi tạo tài khoản hoặc đặt lại mật khẩu.
 *
 * KHÔNG cho đóng bằng Esc hay bấm ra nền: chuỗi này API sinh ra, trả về một lần rồi quên. Đóng
 * nhầm là người dùng mới không đăng nhập được và SA phải đặt lại, lặp cho tới khi có người đọc
 * kịp.
 *
 * NÚT CHÉP là ngoại lệ có chủ ý so với luật "secret không có nút chép" (`ui/copy-button.tsx`):
 * mật khẩu tạm chỉ dùng được một lần, người dùng bị buộc đổi ngay ở lần đăng nhập đầu, và chuỗi
 * đang hiện nguyên văn ngay cạnh nút — chép không lộ thêm gì, còn đọc 16 ký tự qua điện thoại
 * thì dễ sai. "Ẩn" để SA che đi khi đang chia sẻ màn hình.
 *
 * Tạo tài khoản xong thì hiện thêm bước tiếp theo (Q-14: chưa có mail mời). Bấm bước tiếp
 * theo cũng là đóng hộp, nên câu nhắc "ghi lại trước" đứng ngay trên các nút đó.
 */
function TemporaryPasswordDialog({
  password,
  who,
  created,
  onClose,
}: {
  password: string;
  who: string;
  created?: CreatedAccount;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [shown, setShown] = useState(true);
  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={480}
      requireExplicitClose
      title={t('accounts.temporaryPasswordOf', { who })}
      footer={
        <button type="button" className="btn primary" onClick={onClose}>
          {t('accounts.temporaryPasswordDone')}
        </button>
      }
    >
      <div className="temp-password-row">
        {shown ? (
          <p className="mono temp-password" data-testid="temp-password">
            {password}
          </p>
        ) : (
          <p className="mono temp-password" aria-label={t('accounts.passwordMasked')}>
            {'•'.repeat(password.length)}
          </p>
        )}
        <button
          type="button"
          className="btn sm"
          aria-pressed={!shown}
          onClick={() => setShown((value) => !value)}
        >
          {t(shown ? 'accounts.hidePassword' : 'accounts.showPassword')}
        </button>
        <CopyButton value={password} label={t('accounts.copyPassword')} />
      </div>
      <p className="muted">{t('accounts.temporaryPasswordNote')}</p>
      {created ? (
        <section aria-labelledby="temp-password-next">
          <h3 id="temp-password-next">{t('accounts.nextSteps')}</h3>
          <p className="muted">{t('accounts.nextStepsNeedDone')}</p>
          <div className="detail-actions">
            {/* SA/Quản trị xem được mọi secret theo vai — gán quyền két chỉ có nghĩa với Thành viên. */}
            {created.role === 'member' ? (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  onClose();
                  navigate(`${PATHS.adminVaultAccess}?user=${encodeURIComponent(created.id)}`);
                }}
              >
                {t('accounts.nextVaultAccess')}
              </button>
            ) : null}
            <button
              type="button"
              className="btn"
              onClick={() => {
                onClose();
                // Mở sẵn tìm theo tên người: ô tìm thiết bị khớp cả "Người sử dụng" (DEV-013).
                navigate(`${PATHS.devices}?q=${encodeURIComponent(created.fullName)}`);
              }}
            >
              {t('accounts.nextDevices')}
            </button>
          </div>
          <p className="muted">{t('accounts.nextDevicesSearchHint', { name: created.fullName })}</p>
        </section>
      ) : null}
    </Dialog>
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
      apiFetch<SessionItem[]>(`/api/v1/accounts/${account.id}/sessions`, {
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
        <SessionList
          sessions={sessions.data ?? []}
          table
          endLabel={t('accounts.killSession')}
          busy={kill.isPending}
          onEnd={(session) => {
            void (async () => {
              /* Hộp che mất danh sách, nên "phiên NÀY" không còn chỉ vào đâu cả. Nêu IP + lần
                 hoạt động gần nhất: hai thứ phân biệt phiên của mình với phiên kẻ chiếm. */
              const ok = await askConfirm({
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
              });
              if (!ok) return;
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
        />
      )}
    </Dialog>
  );
}

function roleLabel(role: Me['role'], t: (key: string) => string): string {
  return t(
    role === 'sa' ? 'accounts.roleSa' : role === 'admin' ? 'accounts.roleAdmin' : 'accounts.roleMember',
  );
}
