import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { formatDateTime, orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { SECRET_OWNER_KIND_KEY, type SecretOwnerType } from '@/lib/secret-owner-kinds';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { Dialog } from '@/ui/dialog';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field, PageHeader } from '@/ui/page-header';
import { Pagination } from '@/ui/pagination';
import { TabPanel, Tabs } from '@/ui/tabs';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';

interface ApprovalRow {
  id: string;
  kind: string;
  state: string;
  requester: string;
  /* `break-glass.service.ts` gõ trường này là `SecretOwnerType`, tức BỐN loại. Khai `string`
     ở đây là chỗ bản cũ lọt: nhãn chỉ có hai loại mà TS không có cách nào biết. */
  subjectType: SecretOwnerType;
  subjectId: string;
  reason: string;
  payload: { hours?: number } | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  expiresAt: string | null;
  createdAt: string;
  active: boolean;
}

/** Nhật ký và "của tôi" chỉ lớn lên theo thời gian — server cắt trang, màn này không tải cả kho. */
const PAGE_LIMIT = 20;

interface ApprovalPage {
  items: ApprovalRow[];
  total: number;
}

const STATE_LABEL: Record<string, string> = {
  pending: 'approvals.statePending',
  approved: 'approvals.stateApproved',
  denied: 'approvals.stateDenied',
  cancelled: 'approvals.stateCancelled',
  expired: 'approvals.stateExpired',
  revoked: 'approvals.stateRevoked',
};

/**
 * Phiếu ĐÃ DUYỆT nhưng quyền đã hết hiệu lực.
 *
 * `state` chỉ ghi lại một QUYẾT ĐỊNH đã xảy ra và không bao giờ đổi nữa; còn "có đang xem được
 * secret không" là câu trả lời của ĐỒNG HỒ, và server đưa nó xuống qua `active` (AD-6 — client
 * tuyệt đối không tự so giờ). Hai thứ đó khác nhau, và chỗ duy nhất người đọc thấy sự khác
 * nhau ấy là cái huy hiệu trên đầu thẻ.
 */
function expiredGrant(row: { state: string; active: boolean }): boolean {
  return row.state === 'approved' && !row.active;
}

const STATE_TONE: Record<string, string> = {
  pending: 'warn',
  approved: 'ok',
  denied: 'muted',
  cancelled: 'muted',
  expired: 'muted',
  revoked: 'danger',
};

/**
 * Màn duyệt break-glass (story 6.3, FR-023/FR-025).
 *
 * AC đòi màn này dùng được ở 390px, và lý do rất cụ thể: yêu cầu break-glass đến lúc 2 giờ
 * sáng, người duyệt đang ở nhà và chỉ có cái điện thoại. Duyệt không được trên điện thoại thì
 * cả cơ chế này vô dụng đúng vào lúc cần nhất — người trực sẽ đi tìm đường vòng.
 */
export function ApprovalsScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const canDecide = me.role === 'sa' || me.role === 'admin';
  /**
   * Member vào thẳng tab của mình.
   *
   * Trước đây `tab` khởi tạo là 'pending' còn `Tabs` lại ép `value='mine'` cho người không
   * duyệt — nút sáng ở "Yêu cầu của tôi" trong khi dữ liệu render vẫn là của tab 'pending'
   * (đang bị disable, nên rỗng). Member mở màn ra thấy "không có yêu cầu nào" dù họ vừa gửi
   * một cái (code review Epic 6, finding 2).
   */
  const [tab, setTab] = useState(canDecide ? 'pending' : 'mine');
  const [deciding, setDeciding] = useState<{ row: ApprovalRow; approve: boolean } | null>(null);
  /* `?id=` đến từ nút trong thư duyệt: yêu cầu đó lên đầu hàng chờ và được đánh dấu. */
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('id');
  const [logPage, setLogPage] = useState(1);
  const [minePage, setMinePage] = useState(1);


  const pending = useQuery({
    queryKey: ['break-glass', 'pending'],
    queryFn: () => apiFetch<ApprovalRow[]>('/api/v1/vault/break-glass/pending'),
    enabled: canDecide,
  });

  const log = useQuery({
    queryKey: ['break-glass', 'log', logPage],
    queryFn: () =>
      apiFetch<ApprovalPage>(`/api/v1/vault/break-glass/log?page=${logPage}&limit=${PAGE_LIMIT}`),
    enabled: canDecide && tab === 'log',
  });

  const mine = useQuery({
    queryKey: ['break-glass', 'mine', minePage],
    queryFn: () =>
      apiFetch<ApprovalPage>(`/api/v1/vault/break-glass/mine?page=${minePage}&limit=${PAGE_LIMIT}`),
    enabled: tab === 'mine',
  });

  const revoke = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/vault/break-glass/${input.id}/revoke`,
    { csrfToken: me.csrfToken, refreshMe: false, body: () => ({}) },
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['break-glass'] });

  /**
   * `query` của tab đang xem — lấy MỘT lần rồi rút cả ba trạng thái từ đó.
   *
   * Bản trước rút `items`/`loading` bằng hai chuỗi ba nhánh riêng và KHÔNG có nhánh lỗi:
   * `pending.data ?? []` biến một API 500 thành mảng rỗng, nên màn hiện "Chưa có yêu cầu nào
   * chờ duyệt". Đây là màn DUYỆT BREAK-GLASS — admin trực đêm nhìn thấy màn trống và tin là
   * không có ai đang xin quyền khẩn cấp, trong khi phiếu đang nằm đó. Mọi màn khác trong repo
   * đều dùng `LoadError`; riêng màn này thì không import nó.
   */
  const active = tab === 'pending' ? pending : tab === 'log' ? log : mine;
  const loaded =
    (tab === 'pending' ? pending.data : tab === 'log' ? log.data?.items : mine.data?.items) ?? [];
  const focused = focusId && tab === 'pending' ? loaded.find((row) => row.id === focusId) : undefined;
  const items = focused ? [focused, ...loaded.filter((row) => row !== focused)] : loaded;
  // Yêu cầu trong thư đã được người khác xử lý: nói ra, đừng để người duyệt tưởng link hỏng.
  const focusGone = Boolean(focusId) && tab === 'pending' && pending.isSuccess && !focused;
  // Hàng chờ duyệt tự giới hạn (mỗi người một yêu cầu treo trên một đối tượng) nên không phân trang.
  const paged =
    tab === 'log'
      ? { page: logPage, set: setLogPage, total: log.data?.total ?? 0 }
      : tab === 'mine'
        ? { page: minePage, set: setMinePage, total: mine.data?.total ?? 0 }
        : null;
  const loading = active.isLoading;
  const failed = active.isError;

  return (
    <>
      <PageHeader
        title={t('approvals.title')}
        subtitle={t('approvals.subtitle')}
        actions={
          /*
            Nút Xuất CHỈ ở tab Nhật ký, vì file luôn là toàn bộ lịch sử.
            Để nó ở mọi tab thì người đang xem "Chờ duyệt" bấm Xuất và im lặng nhận cả kho —
            trái đúng luật "xuất đúng bộ lọc đang xem" mà mọi màn khác đang theo
            (code review Epic 7). Nhật ký là thứ đem đi trình auditor; file không có cột nào
            chứa secret (FR-026).
          */
          canDecide && tab === 'log' ? (
            <ExportXlsxButton
              url="/api/v1/vault/break-glass/export.xlsx"
              fileName="nhat-ky-break-glass.xlsx"
            />
          ) : null
        }
      />

      <Tabs
        items={[
          ...(canDecide
            ? [
                { key: 'pending', label: t('approvals.tabPending'), count: pending.data?.length },
                { key: 'log', label: t('approvals.tabLog') },
              ]
            : []),
          { key: 'mine', label: t('approvals.tabMine') },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel={t('approvals.title')}
      />

      <TabPanel tabKey={tab}>
        {focusGone ? <p className="muted">{t('approvals.focusGone')}</p> : null}
        {loading ? (
          <Loading />
        ) : failed ? (
          <LoadError error={active.error} onRetry={() => void active.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={t(
              tab === 'pending'
                ? 'approvals.emptyPending'
                : tab === 'log'
                  ? 'approvals.emptyLog'
                  : 'approvals.emptyMine',
            )}
            hint={tab === 'pending' ? t('approvals.emptyPendingHint') : undefined}
          />
        ) : (
          <div className="approval-list">
            {items.map((row) => (
              <section
                key={row.id}
                className="card device-panel"
                aria-label={t('approvals.cardLabel', { member: row.requester })}
                aria-current={row === focused ? 'true' : undefined}
              >
                <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  {/*
                    QUYỀN ĐÃ HẾT HIỆU LỰC THÌ KHÔNG ĐƯỢC ĐEO HUY HIỆU XANH (sửa 17/09/2026).
                    Theo AD-6, hiệu lực tính bằng ĐỒNG HỒ chứ không bằng một lượt ghi, nên một
                    phiếu đã qua hạn vẫn giữ nguyên `state='approved'` và chỉ có `active=false`.
                    Badge lấy theo `state` nên nó vẫn xanh "Đã duyệt", còn sự thật — quyền đã
                    tự cắt — nằm ở dòng chữ nhỏ nhất trên thẻ. Người lướt qua sổ đọc ra đúng
                    điều ngược lại với thực tế. Giờ badge đọc cả `active`.
                  */}
                  <span className={`badge ${expiredGrant(row) ? 'muted' : STATE_TONE[row.state] ?? 'muted'}`}>
                    {expiredGrant(row)
                      ? t('approvals.stateApprovedOver')
                      : t(STATE_LABEL[row.state] ?? row.state)}
                  </span>
                  {row === focused ? (
                    <span className="badge warn">{t('approvals.fromMail')}</span>
                  ) : null}
                  <strong>{row.requester}</strong>
                  <span className="muted">{formatDateTime(row.createdAt)}</span>
                </div>

                <p className="approval-reason">{row.reason}</p>

                <dl className="data-grid">
                  <div className="field">
                    <dt className="lbl-t">{t('approvals.subject')}</dt>
                    <dd className="mono">
                      {t(SECRET_OWNER_KIND_KEY[row.subjectType])} · {row.subjectId.slice(0, 8)}
                    </dd>
                  </div>
                  <div className="field">
                    <dt className="lbl-t">{t('approvals.asked')}</dt>
                    <dd>
                      {/* KHÔNG ghép dấu gạch với đơn vị: "— giờ" không phải một câu trả lời,
                          nó là một chỗ trống đội lốt câu trả lời. Không biết thì nói không
                          biết. */}
                      {row.payload?.hours === undefined
                        ? t('approvals.hoursUnknown')
                        : t('approvals.hours', { hours: row.payload.hours })}
                    </dd>
                  </div>
                  {row.decidedBy ? (
                    <div className="field">
                      <dt className="lbl-t">{t('approvals.decidedBy')}</dt>
                      <dd>
                        {row.decidedBy}
                        <span className="cell-sub">{orDash(row.decisionNote)}</span>
                      </dd>
                    </div>
                  ) : null}
                  {row.expiresAt ? (
                    <div className="field">
                      <dt className="lbl-t">{t('approvals.expiresAt')}</dt>
                      <dd>
                        {formatDateTime(row.expiresAt)}
                        {/* `active` do SERVER tính bằng đồng hồ (AD-6) — client không tự so giờ. */}
                        {!row.active && row.state === 'approved' ? (
                          <span className="cell-sub">{t('approvals.alreadyOver')}</span>
                        ) : null}
                      </dd>
                    </div>
                  ) : null}
                </dl>

                {canDecide && row.state === 'pending' ? (
                  <div className="action-cell">
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => setDeciding({ row, approve: true })}
                    >
                      {t('approvals.approve')}
                    </button>
                    <button
                      type="button"
                      className="btn danger"
                      onClick={() => setDeciding({ row, approve: false })}
                    >
                      {t('approvals.deny')}
                    </button>
                  </div>
                ) : null}

                {canDecide && row.state === 'approved' && row.active ? (
                  <div className="action-cell">
                    <button
                      type="button"
                      className="btn sm danger"
                      disabled={revoke.isPending}
                      /*
                       * PHẢI hỏi lại: nút này CẮT một quyền ĐANG CHẠY của người khác — có thể
                       * họ đang mở két giữa lúc xử sự cố. Đây là thao tác phá duy nhất trong
                       * cụm Két sắt đi thẳng vào `mutate`, trong khi hai chỗ anh em
                       * (`access-matrix-screen` gỡ quyền, `vault-panel` thu hồi ngăn) đều qua
                       * `askConfirm({ danger: true })`. Nút lại nằm ngay dưới cặp Duyệt/Từ chối
                       * trên cùng một thẻ phiếu, nên trượt tay là cắt nhầm.
                       */
                      onClick={() => {
                        void (async () => {
                          const ok = await askConfirm({
                            title: t('common.titleOf', {
                              action: t('approvals.revoke'),
                              subject: row.requester,
                            }),
                            message: t('approvals.confirmRevoke', { member: row.requester }),
                            danger: true,
                            confirmLabel: t('approvals.revoke'),
                          });
                          if (!ok) return;
                          revoke.mutate(
                            { id: row.id },
                            {
                              onSuccess: () => {
                                toast({ message: t('approvals.revoked') });
                                void refresh();
                              },
                              onError: (error) =>
                                toast({ message: errorMessage(error), tone: 'error' }),
                            },
                          );
                        })();
                      }}
                    >
                      {t('approvals.revoke')}
                    </button>
                  </div>
                ) : null}
              </section>
            ))}
            {paged ? (
              <Pagination
                page={paged.page}
                limit={PAGE_LIMIT}
                total={paged.total}
                onPageChange={paged.set}
              />
            ) : null}
          </div>
        )}
      </TabPanel>

      {deciding ? (
        <DecisionDialog
          row={deciding.row}
          approve={deciding.approve}
          csrfToken={me.csrfToken}
          onClose={() => setDeciding(null)}
          onDone={() => {
            setDeciding(null);
            toast({ message: t(deciding.approve ? 'approvals.approved' : 'approvals.denied') });
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Người duyệt chốt — và được RÚT NGẮN thời hạn.
 *
 * Ô giờ điền sẵn con số người xin đề nghị, nhưng sửa được: người duyệt nhìn lý do rồi quyết,
 * chứ không phải bấm đồng ý với con số người xin tự đặt. "Xin 24 giờ để đổi một cái mật khẩu"
 * thì duyệt 2 giờ là đủ.
 */
function DecisionDialog({
  row,
  approve,
  csrfToken,
  onClose,
  onDone,
}: {
  row: ApprovalRow;
  approve: boolean;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [hours, setHours] = useState(String(row.payload?.hours ?? 4));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const decide = useApiMutation<Record<string, unknown>, unknown>(
    `/api/v1/vault/break-glass/${row.id}/${approve ? 'approve' : 'deny'}`,
    { csrfToken, refreshMe: false },
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ.
         `guardUnsaved`: chưa bấm Lưu mà lỡ Esc thì hỏi lại, đừng xoá trắng. */
      dismissible={!decide.isPending}
      guardUnsaved
      maxWidth={460}
      title={t(approve ? 'approvals.approveTitle' : 'approvals.denyTitle', {
        member: row.requester,
      })}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="decision-form"
            className={approve ? 'btn primary' : 'btn danger'}
            disabled={decide.isPending}
          >
            {decide.isPending
              ? t('common.loading')
              : t(approve ? 'approvals.approve' : 'approvals.deny')}
          </button>
        </>
      }
    >
      <form
        id="decision-form"
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          /*
           * KHÔNG ĐƯỢC ÂM THẦM RƠI VỀ 4 GIỜ (sửa 17/09/2026).
           *
           * Bản cũ viết `Number(hours) || 4`. Gõ "2 tiếng" ra `NaN`, gõ "0" ra `0` — cả hai đều
           * falsy, và cả hai đều lặng lẽ thành **cấp 4 giờ**, khác hẳn con số người duyệt vừa
           * gõ và cũng khác con số người xin đề nghị. Đây là màn cấp quyền đọc mật khẩu: một
           * con số sai ở đây là một cửa mở lâu hơn dự định, và không có gì trên màn nói ra.
           * Nói thẳng là không hiểu, để người duyệt gõ lại.
           */
          if (approve) {
            const asked = Number(hours.trim());
            if (!Number.isInteger(asked) || asked <= 0) {
              setError(t('approvals.grantHoursInvalid'));
              return;
            }
            decide.mutate(
              { hours: asked, note: note.trim() },
              { onSuccess: onDone, onError: (err) => setError(errorMessage(err)) },
            );
            return;
          }
          decide.mutate(
            { note: note.trim() },
            { onSuccess: onDone, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <p className="approval-reason">{row.reason}</p>

        {approve ? (
          <Field
            label={t('approvals.grantHours')}
            required
            hint={t('approvals.grantHoursHint')}
            htmlFor="decide-hours"
          >
            <input
              id="decide-hours"
              className="inp"
              required
              inputMode="numeric"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </Field>
        ) : null}

        <Field label={t('approvals.note')} htmlFor="decide-note">
          <input
            id="decide-note"
            className="inp"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
