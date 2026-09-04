import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { formatDateTime, orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { Dialog } from '@/ui/dialog';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field, PageHeader } from '@/ui/page-header';
import { TabPanel, Tabs } from '@/ui/tabs';
import { useToast } from '@/ui/toast';

interface ApprovalRow {
  id: string;
  kind: string;
  state: string;
  requester: string;
  subjectType: string;
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

const STATE_LABEL: Record<string, string> = {
  pending: 'approvals.statePending',
  approved: 'approvals.stateApproved',
  denied: 'approvals.stateDenied',
  cancelled: 'approvals.stateCancelled',
  expired: 'approvals.stateExpired',
  revoked: 'approvals.stateRevoked',
};

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


  const pending = useQuery({
    queryKey: ['break-glass', 'pending'],
    queryFn: () => apiFetch<ApprovalRow[]>('/api/v1/vault/break-glass/pending'),
    enabled: canDecide,
  });

  const log = useQuery({
    queryKey: ['break-glass', 'log'],
    queryFn: () => apiFetch<ApprovalRow[]>('/api/v1/vault/break-glass/log'),
    enabled: canDecide && tab === 'log',
  });

  const mine = useQuery({
    queryKey: ['break-glass', 'mine'],
    queryFn: () => apiFetch<ApprovalRow[]>('/api/v1/vault/break-glass/mine'),
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
  const items = active.data ?? [];
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
        {loading ? (
          <Loading />
        ) : failed ? (
          <LoadError onRetry={() => void active.refetch()} />
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
              <section key={row.id} className="card device-panel">
                <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <span className={`badge ${STATE_TONE[row.state] ?? 'muted'}`}>
                    {t(STATE_LABEL[row.state] ?? row.state)}
                  </span>
                  <strong>{row.requester}</strong>
                  <span className="muted">{formatDateTime(row.createdAt)}</span>
                </div>

                <p className="approval-reason">{row.reason}</p>

                <dl className="data-grid">
                  <div className="field">
                    <dt className="lbl-t">{t('approvals.subject')}</dt>
                    <dd className="mono">
                      {t(`approvals.subject_${row.subjectType}`)} · {row.subjectId.slice(0, 8)}
                    </dd>
                  </div>
                  <div className="field">
                    <dt className="lbl-t">{t('approvals.asked')}</dt>
                    <dd>{t('approvals.hours', { hours: row.payload?.hours ?? '—' })}</dd>
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
                      onClick={() =>
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
                        )
                      }
                    >
                      {t('approvals.revoke')}
                    </button>
                  </div>
                ) : null}
              </section>
            ))}
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
          decide.mutate(
            approve ? { hours: Number(hours) || 4, note: note.trim() } : { note: note.trim() },
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
