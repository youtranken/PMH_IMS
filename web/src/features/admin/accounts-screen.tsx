import { useCallback, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { agoParts, formatDateTime, orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { sortQuery } from '@/lib/sort-query';
import { DataTable, type MobileCard } from '@/ui/data-table';
import { Dialog } from '@/ui/dialog';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { FilterBar } from '@/ui/filter-bar';
import { useClampPage, useListUrlState } from '@/ui/use-list-url-state';
import { LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { Pagination } from '@/ui/pagination';
import { RowActions, type RowAction } from '@/ui/row-actions';
import { Select } from '@/ui/select';
import { useConfirm } from '@/ui/confirm-provider';
import { CopyButton } from '@/ui/copy-button';
import { SessionList, type SessionItem } from '@/ui/session-list';
import { useStepUpRetry } from '@/ui/use-step-up-retry';
import { useToast } from '@/ui/toast';
import { PATHS } from '@/lib/routes';
import { AccountForm } from './account-form';
import { AccountStatusDialog, RoleDialog } from './account-dialogs';

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
  /** Bộ đếm gõ sai + mốc tạm chặn do đăng nhập sai liên tiếp (không phải "Khóa" của SA). */
  failedAttempts?: number;
  lockedUntil?: string | null;
  createdAt?: string;
}

type AccountStatus = AccountRow['status'];

/**
 * BA trạng thái tài khoản, và việc đổi trạng thái hợp lệ ở từng trạng thái.
 *
 * Bảng chứ không phải `if`: khóa là TẠM, vô hiệu hóa là cho người đã nghỉ hẳn —
 * `auth.service.ts` trả hai mã lỗi khác nhau đúng vì thế, nên menu không được gộp hai việc
 * làm một nút. `Record<AccountStatus, …>` nên thêm trạng thái thứ tư là lỗi BIÊN DỊCH.
 */
interface StatusAction {
  key: string;
  /** Khóa i18n của nhãn menu — dùng lại làm nhãn nút xác nhận. */
  label: string;
  to: AccountStatus;
  /**
   * `warn` = lấy đi nhưng mở lại được (khóa tạm); `danger` = cắt hẳn (vô hiệu hóa). Trả lại
   * quyền thì không tô màu gì.
   */
  tone: 'normal' | 'warn' | 'danger';
  /** Lấy quyền thì bắt ghi lý do (hộp riêng); trả quyền thì chỉ hỏi lại. */
  needsReason: boolean;
  confirm: string;
  /** Mọi lần đổi trạng thái đều phải có phản hồi. */
  done: string;
}

const STATUS_ACTIONS: Record<AccountStatus, StatusAction[]> = {
  active: [
    {
      key: 'lock',
      label: 'accounts.lock',
      to: 'locked',
      tone: 'warn',
      needsReason: true,
      confirm: 'accounts.confirmLock',
      done: 'accounts.toastLocked',
    },
    {
      key: 'disable',
      label: 'accounts.disable',
      to: 'disabled',
      tone: 'danger',
      needsReason: true,
      confirm: 'accounts.confirmDisable',
      done: 'accounts.toastDisabled',
    },
  ],
  locked: [
    {
      key: 'unlock',
      label: 'accounts.unlock',
      to: 'active',
      tone: 'normal',
      needsReason: false,
      confirm: 'accounts.confirmUnlock',
      done: 'accounts.toastUnlocked',
    },
    {
      key: 'disable',
      label: 'accounts.disable',
      to: 'disabled',
      tone: 'danger',
      needsReason: true,
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
      tone: 'normal',
      needsReason: false,
      confirm: 'accounts.confirmReactivate',
      done: 'accounts.toastReactivated',
    },
  ],
};

/**
 * Cột "2 lớp" — BA trạng thái, vì trường hợp nguy hiểm là "bắt buộc mà chưa cài" (lần đăng
 * nhập tới sẽ bị đòi cài ngay) chứ không phải "không bắt buộc".
 */
export function totpState(row: { totpEnrolledAt: string | null; totpLoginRequired: boolean }): {
  label: string;
  tone: 'ok' | 'warn' | 'muted';
} {
  if (row.totpEnrolledAt) return { label: 'accounts.totpStateEnrolled', tone: 'ok' };
  if (row.totpLoginRequired) return { label: 'accounts.totpStateMissing', tone: 'warn' };
  return { label: 'accounts.totpStateOptional', tone: 'muted' };
}

/**
 * Tài khoản "Đang hoạt động" nhưng đang bị TẠM CHẶN vì gõ sai nhiều lần — người dùng gọi
 * "không đăng nhập được" mà badge vẫn xanh. `null` khi không bị chặn (hoặc mốc đã qua).
 */
export function tempLockOf(
  row: { status: AccountStatus; lockedUntil?: string | null; failedAttempts?: number },
  now: number,
): { until: string; attempts: number } | null {
  if (row.status !== 'active' || !row.lockedUntil) return null;
  if (Date.parse(row.lockedUntil) <= now) return null;
  return { until: row.lockedUntil, attempts: row.failedAttempts ?? 0 };
}

const STATUS_LABEL: Record<AccountStatus, string> = {
  active: 'accounts.statusActive',
  locked: 'accounts.statusLocked',
  disabled: 'accounts.statusDisabled',
};

/** Khóa là tạm (`warn`), vô hiệu hóa là dứt (`danger`). */
const STATUS_TONE: Record<AccountStatus, string> = {
  active: 'ok',
  locked: 'warn',
  disabled: 'danger',
};

/** Vai cao nhất đậm nhất: SA (toàn quyền) viền đỏ, Quản trị cảnh báo, Thành viên trung tính. */
const ROLE_TONE: Record<Me['role'], string> = {
  sa: 'danger',
  admin: 'warn',
  member: 'muted',
};

const DEFAULT_LIMIT = 20;

interface AccountFilters extends Record<string, string> {
  search: string;
  role: string;
  status: string;
  totp: string;
}

const EMPTY_FILTERS: AccountFilters = { search: '', role: '', status: '', totp: '' };

function filterQuery(filters: AccountFilters): string[] {
  return [
    filters.search ? `search=${encodeURIComponent(filters.search)}` : '',
    filters.role ? `role=${filters.role}` : '',
    filters.status ? `status=${filters.status}` : '',
    filters.totp ? `totp=${filters.totp}` : '',
  ].filter(Boolean);
}

/** Story 1.4 — SA quản trị tài khoản và phiên. */
export function AccountsScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  /* Trạng thái danh sách sống trên THANH ĐỊA CHỈ: chia sẻ được link đã lọc, Back gỡ bộ lọc. */
  const url = useListUrlState<AccountFilters>({
    emptyFilters: EMPTY_FILTERS,
    defaultLimit: DEFAULT_LIMIT,
    defaultSort: { key: 'fullName', desc: false },
    searchKey: 'search',
  });
  const { page, limit, filters } = url;
  // Sắp xếp chạy ở SERVER (`manualSorting`): sắp ở client chỉ đảo chỗ 20 dòng đang xem.
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
  const [statusFor, setStatusFor] = useState<{ account: AccountRow; action: StatusAction } | null>(
    null,
  );
  const [roleFor, setRoleFor] = useState<AccountRow | null>(null);
  /* Mọi lệnh ghi ở màn này đòi step-up (`@RequiresStepUp`): hết ân hạn thì hỏi mã rồi chạy lại. */
  const stepUp = useStepUpRetry(me.csrfToken);
  const runWithStepUp = stepUp.run;

  const accounts = useQuery({
    queryKey: ['accounts', page, limit, filters, sorting],
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiFetch<{ items: AccountRow[]; total: number }>(
        `/api/v1/accounts?${[`page=${page}`, `limit=${limit}`, ...filterQuery(filters), sortQuery(sorting)]
          .filter(Boolean)
          .join('&')}`,
        { credentials: 'include' },
      ),
  });
  useClampPage(url, accounts.data?.total);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['accounts'] }),
    [queryClient],
  );
  const csrfToken = me.csrfToken;

  // `id` nằm ở ĐƯỜNG DẪN, không được lọt vào body (forbidNonWhitelisted → 400).
  const setStatus = useApiMutation<{ id: string; status: string; reason?: string }, unknown>(
    (input) => `/api/v1/accounts/${input.id}/status`,
    {
      method: 'PATCH',
      csrfToken,
      refreshMe: false,
      body: (input) => (input.reason ? { status: input.status, reason: input.reason } : { status: input.status }),
    },
  );
  const setRole = useApiMutation<{ id: string; role: Me['role'] }, unknown>(
    (input) => `/api/v1/accounts/${input.id}/role`,
    { method: 'PATCH', csrfToken, refreshMe: false, body: (input) => ({ role: input.role }) },
  );
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
   * Hỏi lại → (step-up nếu cần) → toast. Một cửa cho các việc trên menu dòng, để không việc
   * nào lặng lẽ chạy mà không có phản hồi.
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

  /** Đặt lại mật khẩu; tài khoản đang KHÓA thì mở khóa luôn (bật sẵn) — không thì vẫn không vào được. */
  const doResetPassword = useCallback(
    async (account: AccountRow) => {
      const locked = account.status === 'locked';
      const heading = t('common.titleOf', {
        action: t('accounts.resetPassword'),
        subject: account.fullName,
      });
      const message = t('accounts.confirmResetPassword', { name: account.fullName });
      const confirmLabel = t('accounts.resetPassword');
      const answer = locked
        ? await askConfirm({
            title: heading,
            message,
            confirmLabel,
            checkbox: { label: t('accounts.resetAlsoUnlock'), defaultChecked: true },
          })
        : { ok: await askConfirm({ title: heading, message, confirmLabel }), checked: false };
      if (!answer.ok) return;
      const unlock = answer.checked;
      try {
        const result = await runWithStepUp(() => resetPassword.mutateAsync({ id: account.id }));
        if (unlock) {
          await runWithStepUp(() => setStatus.mutateAsync({ id: account.id, status: 'active' }));
          toast({ message: t('accounts.toastUnlocked', { name: account.fullName }) });
        }
        void refresh();
        setTemporaryPassword({ password: result.temporaryPassword, who: account.email });
      } catch (err) {
        if (err instanceof Error && err.message === 'STEPUP_CANCELLED') return;
        toast({ message: errorMessage(err), tone: 'error' });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [askConfirm, runWithStepUp, toast, refresh, t, resetPassword.mutateAsync, setStatus.mutateAsync],
  );

  const rows = accounts.data?.items ?? [];
  const now = Date.now();

  /**
   * Menu dòng, chia NHÓM theo mức độ (RowActions tự kẻ vạch giữa các nhóm):
   * xem/sửa · đặt lại (việc thường, không lấy gì của ai) · khóa (warn) · vô hiệu hóa (danger).
   * Dòng của CHÍNH MÌNH không có khóa / vô hiệu / đặt lại 2 lớp / đổi vai — API đã chặn, bày
   * ra rồi báo lỗi là mời bấm vào ngõ cụt.
   */
  const actionsFor = (account: AccountRow): RowAction[] => {
    const self = account.id === me.id;
    const busy = setStatus.isPending || resetPassword.isPending || resetTotp.isPending;
    const temp = tempLockOf(account, now);
    const items: RowAction[] = [
      { key: 'edit', label: t('common.edit'), disabled: busy, onSelect: () => setEditing(account) },
      {
        key: 'sessions',
        label: t('accounts.sessions'),
        disabled: busy,
        onSelect: () => setSessionsFor(account),
      },
      ...(account.role === 'member'
        ? [
            {
              key: 'vault',
              label: t('accounts.vaultAccess'),
              onSelect: () =>
                navigate(`${PATHS.adminVaultAccess}?user=${encodeURIComponent(account.id)}`),
            },
          ]
        : []),
      {
        key: 'audit',
        label: t('accounts.auditLog'),
        onSelect: () =>
          navigate(`${PATHS.adminAuditLog}?objectId=${encodeURIComponent(account.id)}`),
      },
      {
        key: 'reset-password',
        label: t('accounts.resetPassword'),
        disabled: resetPassword.isPending,
        onSelect: () => void doResetPassword(account),
      },
    ];
    if (temp) {
      items.push({
        key: 'clear-lockout',
        label: t('accounts.clearLockout'),
        disabled: setStatus.isPending,
        onSelect: () =>
          void confirmThenRun({
            title: t('common.titleOf', { action: t('accounts.clearLockout'), subject: account.fullName }),
            message: t('accounts.confirmClearLockout', { name: account.fullName }),
            danger: false,
            confirmLabel: t('accounts.clearLockout'),
            run: () => setStatus.mutateAsync({ id: account.id, status: 'active' }),
            done: t('accounts.toastClearLockout', { name: account.fullName }),
          }),
      });
    }
    if (!self) {
      items.push(
        {
          key: 'reset-totp',
          label: t('accounts.resetTotp'),
          disabled: resetTotp.isPending,
          onSelect: () =>
            void confirmThenRun({
              title: t('common.titleOf', { action: t('accounts.resetTotp'), subject: account.fullName }),
              message: t('accounts.confirmResetTotp', { name: account.fullName }),
              danger: true,
              confirmLabel: t('accounts.resetTotp'),
              run: () => resetTotp.mutateAsync({ id: account.id }),
              done: t('accounts.totpReset'),
            }),
        },
        {
          key: 'role',
          label: t('accounts.changeRole'),
          onSelect: () => setRoleFor(account),
        },
      );
    }
    /* Bật/tắt cưỡng chế 2 lớp (NFR-01). TẮT là hạ rào (warn); bật lại không lấy gì của ai. */
    items.push({
      key: 'totp-required',
      label: t(account.totpLoginRequired ? 'accounts.totpRequireOff' : 'accounts.totpRequireOn'),
      warn: account.totpLoginRequired,
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
          done: t(required ? 'accounts.toastTotpRequireOn' : 'accounts.toastTotpRequireOff', {
            name: account.fullName,
          }),
        });
      },
    });
    for (const action of STATUS_ACTIONS[account.status]) {
      if (self && action.to !== 'active') continue;
      items.push({
        key: action.key,
        label: t(action.label),
        warn: action.tone === 'warn',
        danger: action.tone === 'danger',
        disabled: setStatus.isPending,
        onSelect: () => {
          if (action.needsReason) {
            setStatusFor({ account, action });
            return;
          }
          void confirmThenRun({
            title: t('common.titleOf', { action: t(action.label), subject: account.fullName }),
            message: t(action.confirm, { name: account.fullName }),
            danger: false,
            confirmLabel: t(action.label),
            run: () => setStatus.mutateAsync({ id: account.id, status: action.to }),
            done: t(action.done, { name: account.fullName }),
          });
        },
      });
    }
    return items;
  };

  const nameCell = (account: AccountRow) => (
    <>
      {account.fullName}
      {account.id === me.id ? <span className="badge info plain">{t('accounts.you')}</span> : null}
      {/* Mã nhân viên đi cùng tên vì đó là cách Nhân sự gọi một người; email và SĐT xuống
          dòng nhỏ. Bảng đã 6 cột, thêm hai cột ngắn là bắt cuộn ngang để đọc một con số. */}
      {account.employeeCode ? <span className="mono"> · {account.employeeCode}</span> : null}
      <span className="cell-sub">
        {account.email}
        {account.phone ? ` · ${account.phone}` : ''}
      </span>
    </>
  );

  const statusCell = (account: AccountRow) => {
    const temp = tempLockOf(account, now);
    return (
      <>
        <span className={`badge ${STATUS_TONE[account.status]}`}>{t(STATUS_LABEL[account.status])}</span>
        {temp ? (
          <span className="badge warn plain" title={formatDateTime(temp.until)}>
            {t('accounts.tempLocked', {
              time: formatDateTime(temp.until).split(' ').pop(),
              count: temp.attempts,
            })}
          </span>
        ) : null}
      </>
    );
  };

  /** "2 giờ trước" + giờ tuyệt đối khi rê chuột; chưa từng vào thì nói rõ, kèm ngày tạo. */
  const lastLoginCell = (account: AccountRow) => {
    if (!account.lastLoginAt) {
      return (
        <span className="muted" title={account.createdAt ? formatDateTime(account.createdAt) : undefined}>
          {account.createdAt
            ? t('accounts.neverLoggedInSince', { ago: agoText(account.createdAt, now) })
            : t('accounts.neverLoggedIn')}
        </span>
      );
    }
    return <span title={formatDateTime(account.lastLoginAt)}>{agoText(account.lastLoginAt, now)}</span>;
  };

  function agoText(value: string, at: number): string {
    const ago = agoParts(value, at);
    if (!ago) return orDash(null);
    if (ago.unit === 'days' && ago.count > 30) return formatDateTime(value);
    return t(`accounts.ago_${ago.unit}`, { count: ago.count });
  }

  /**
   * `accessorKey` PHẢI khớp whitelist `USER_SORT_KEYS` phía API — đó là tên cột gửi lên trong
   * `?sort=`. `email` không có cột riêng (chỉ là dòng phụ dưới Họ tên) nên không sắp được.
   */
  const columns = useMemo<ColumnDef<AccountRow, unknown>[]>(
    () => [
      {
        accessorKey: 'fullName',
        header: t('accounts.fullName'),
        cell: ({ row }) => nameCell(row.original),
      },
      {
        accessorKey: 'role',
        header: t('accounts.role'),
        cell: ({ row }) => (
          <span className={`badge plain ${ROLE_TONE[row.original.role]}`}>
            {roleLabel(row.original.role, t)}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: t('accounts.status'),
        cell: ({ row }) => statusCell(row.original),
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
        /* `col-right` = KHÔNG gãy dòng (table.css): mốc thời gian rơi xuống hai dòng là mọi
           hàng của bảng cao gấp đôi vì đúng một cột. */
        meta: { className: 'col-right' },
        cell: ({ row }) => lastLoginCell(row.original),
      },
      {
        id: 'actions',
        header: t('common.actions'),
        meta: { className: 'col-center' },
        cell: ({ row }) => (
          <div className="action-cell">
            <RowActions
              label={t('common.actionsOf', { subject: row.original.fullName })}
              subject={row.original.fullName}
              items={actionsFor(row.original)}
            />
          </div>
        ),
      },
    ],
    /*
     * Deps là THUỘC TÍNH được dùng, không phải cả đối tượng mutation (TanStack dựng lại nó mỗi
     * render). Thêm thuộc tính mới vào thân memo thì phải tự khai xuống dưới.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      t,
      me.id,
      setStatus.mutateAsync,
      setStatus.isPending,
      resetPassword.isPending,
      resetTotp.mutateAsync,
      resetTotp.isPending,
      setTotpRequired.mutateAsync,
      setTotpRequired.isPending,
      confirmThenRun,
      doResetPassword,
    ],
  );

  /* Thẻ gọn ≤600px: tên + vai, dòng 2 email · SĐT, dòng 3 chỉ những gì BẤT THƯỜNG. */
  const mobileCard: MobileCard<AccountRow> = {
    title: (row) => row.fullName,
    badge: (row) => (
      <span className={`badge plain ${ROLE_TONE[row.role]}`}>{roleLabel(row.role, t)}</span>
    ),
    actions: (row) => (
      <RowActions
        label={t('common.actionsOf', { subject: row.fullName })}
        subject={row.fullName}
        items={actionsFor(row)}
      />
    ),
    subtitle: (row) => [row.email, row.phone].filter(Boolean).join(' · '),
    meta: (row) => {
      const temp = tempLockOf(row, now);
      const flags = [
        row.id === me.id ? t('accounts.you') : null,
        row.status !== 'active' ? t(STATUS_LABEL[row.status]) : null,
        temp ? t('accounts.tempLockedShort') : null,
        !row.totpEnrolledAt ? t('accounts.noTotpShort') : null,
      ].filter(Boolean);
      return flags.length > 0 ? flags.join(' · ') : null;
    },
  };

  const exportUrl = `/api/v1/accounts/export?${[...filterQuery(filters), sortQuery(sorting)]
    .filter(Boolean)
    .join('&')}`;

  return (
    <>
      <PageHeader
        title={t('accounts.title')}
        subtitle={t('accounts.subtitle')}
        actions={
          <>
            <ExportXlsxButton url={exportUrl} fileName="tai-khoan.xlsx" />
            <button type="button" className="btn primary" onClick={() => setCreating(true)}>
              {t('accounts.create')}
            </button>
          </>
        }
      />

      <FilterBar
        search={url.searchInput}
        onSearchChange={url.setSearchInput}
        searchPlaceholder={t('accounts.searchPlaceholder')}
        activeCount={url.activeCount}
        onClear={url.clearFilters}
      >
        <Select
          value={filters.role}
          ariaLabel={t('accounts.filterRole')}
          placeholder={t('accounts.allRoles')}
          options={[
            { value: '', label: t('accounts.allRoles') },
            { value: 'sa', label: t('accounts.roleSa') },
            { value: 'admin', label: t('accounts.roleAdmin') },
            { value: 'member', label: t('accounts.roleMember') },
          ]}
          onChange={(value) => url.setFilter('role', value)}
        />
        <Select
          value={filters.status}
          ariaLabel={t('accounts.filterStatus')}
          placeholder={t('accounts.allStatuses')}
          options={[
            { value: '', label: t('accounts.allStatuses') },
            { value: 'active', label: t('accounts.statusActive') },
            { value: 'locked', label: t('accounts.statusLocked') },
            { value: 'disabled', label: t('accounts.statusDisabled') },
          ]}
          onChange={(value) => url.setFilter('status', value)}
        />
        <Select
          value={filters.totp}
          ariaLabel={t('accounts.filterTotp')}
          placeholder={t('accounts.allTotp')}
          options={[
            { value: '', label: t('accounts.allTotp') },
            { value: 'none', label: t('accounts.totpNone') },
            { value: 'enrolled', label: t('accounts.totpStateEnrolled') },
          ]}
          onChange={(value) => url.setFilter('totp', value)}
        />
      </FilterBar>

      {accounts.isLoading ? (
        <Loading />
      ) : accounts.isError ? (
        <LoadError error={accounts.error} onRetry={() => void accounts.refetch()} />
      ) : (
        <>
          <DataTable
            data={rows}
            columns={columns}
            emptyText={url.isFiltered ? t('accounts.emptyFiltered') : t('accounts.empty')}
            stackOnMobile
            mobileCard={mobileCard}
            manualSorting
            sorting={sorting}
            onSortingChange={(updater) => {
              const next = typeof updater === 'function' ? updater(sorting) : updater;
              const first = next[0];
              // Hook tự bỏ `page` khỏi URL khi đổi cột sắp.
              url.setSorting(
                first ? { key: String(first.id), desc: !!first.desc } : { key: 'fullName', desc: false },
              );
            }}
          />

          <Pagination
            page={page}
            limit={limit}
            onLimitChange={url.setLimit}
            total={accounts.data?.total ?? 0}
            onPageChange={url.setPage}
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

      {statusFor ? (
        <AccountStatusDialog
          account={statusFor.account}
          to={statusFor.action.to as 'locked' | 'disabled'}
          title={t('common.titleOf', {
            action: t(statusFor.action.label),
            subject: statusFor.account.fullName,
          })}
          message={t(statusFor.action.confirm, { name: statusFor.account.fullName })}
          confirmLabel={t(statusFor.action.label)}
          danger={statusFor.action.tone === 'danger'}
          onClose={() => setStatusFor(null)}
          onSubmit={async (reason) => {
            const { account, action } = statusFor;
            await runWithStepUp(() =>
              setStatus.mutateAsync({ id: account.id, status: action.to, reason }),
            );
            setStatusFor(null);
            toast({ message: t(action.done, { name: account.fullName }) });
            void refresh();
          }}
        />
      ) : null}

      {roleFor ? (
        <RoleDialog
          account={roleFor}
          onClose={() => setRoleFor(null)}
          onSubmit={async (role) => {
            await runWithStepUp(() => setRole.mutateAsync({ id: roleFor.id, role }));
            toast({
              message: t('accounts.toastRoleChanged', {
                name: roleFor.fullName,
                role: roleLabel(role, t),
              }),
            });
            setRoleFor(null);
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
 * nhầm là người dùng mới không đăng nhập được và SA phải đặt lại.
 *
 * NÚT CHÉP là ngoại lệ có chủ ý so với luật "secret không có nút chép" (`ui/copy-button.tsx`):
 * mật khẩu tạm chỉ dùng được một lần, bị buộc đổi ngay ở lần đăng nhập đầu, và đang hiện
 * nguyên văn ngay cạnh nút. "Ẩn" để SA che đi khi đang chia sẻ màn hình.
 *
 * Tạo tài khoản xong thì hiện thêm bước tiếp theo (Q-14: chưa có mail mời).
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
      maxWidth={680}
      title={t('accounts.sessionsOf', { name: account.fullName })}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      {sessions.isLoading ? (
        <Loading />
      ) : sessions.isError ? (
        /*
         * "KHÔNG CÒN PHIÊN NÀO" LÀ CÂU TRẢ LỜI CỦA MÀN NÀY — nên nó không được nói ra khi chưa
         * hỏi được: đây là màn người ta mở đúng lúc nghi một tài khoản bị chiếm.
         */
        <LoadError error={sessions.error} onRetry={() => void sessions.refetch()} />
      ) : (sessions.data ?? []).length === 0 ? (
        <p className="muted">{t('accounts.noSessions')}</p>
      ) : (
        <SessionList
          sessions={sessions.data ?? []}
          table
          canEndCurrent
          currentLabel={t('accounts.thisSession')}
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
