import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import { formatDateTime, orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import {
  BREAK_GLASS_KEY,
  BreakGlassStateBadge,
  BreakGlassSubject,
  DecisionDialog,
  isStepUpCancelled,
  useBreakGlassActions,
  type BreakGlassRow,
} from '@/ui/break-glass';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { Pagination } from '@/ui/pagination';
import { TabPanel, Tabs } from '@/ui/tabs';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';

type ApprovalRow = BreakGlassRow;

/** Nhật ký và "của tôi" chỉ lớn lên theo thời gian — server cắt trang, màn này không tải cả kho. */
const PAGE_LIMIT = 20;

interface ApprovalPage {
  items: ApprovalRow[];
  total: number;
}

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
  const canDecide = me.role === 'sa' || me.role === 'admin';
  /**
   * Member vào thẳng tab của mình — `tab` khởi tạo phải khớp tab `Tabs` đang sáng, không thì
   * nút sáng ở "Yêu cầu của tôi" mà dữ liệu render lại là của tab 'pending' (rỗng với Member).
   */
  const [tab, setTab] = useState(canDecide ? 'pending' : 'mine');
  const [deciding, setDeciding] = useState<{ row: ApprovalRow; approve: boolean } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /* `?id=` đến từ link thư cũ: yêu cầu đó lên đầu hàng chờ và được đánh dấu. Thư mới trỏ thẳng
     trang chi tiết `/approvals/<id>`. */
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('id');
  const [logPage, setLogPage] = useState(1);
  const [minePage, setMinePage] = useState(1);
  const actions = useBreakGlassActions(me.csrfToken);
  const myEmail = me.email.toLowerCase();

  const pending = useQuery({
    queryKey: [...BREAK_GLASS_KEY, 'pending'],
    queryFn: () => apiFetch<ApprovalRow[]>('/api/v1/vault/break-glass/pending'),
    enabled: canDecide,
  });

  const log = useQuery({
    queryKey: [...BREAK_GLASS_KEY, 'log', logPage],
    queryFn: () =>
      apiFetch<ApprovalPage>(`/api/v1/vault/break-glass/log?page=${logPage}&limit=${PAGE_LIMIT}`),
    enabled: canDecide && tab === 'log',
  });

  const mine = useQuery({
    queryKey: [...BREAK_GLASS_KEY, 'mine', minePage],
    queryFn: () =>
      apiFetch<ApprovalPage>(`/api/v1/vault/break-glass/mine?page=${minePage}&limit=${PAGE_LIMIT}`),
    enabled: tab === 'mine',
  });

  /**
   * Chạy một lệnh trên MỘT phiếu: khoá nút của phiếu đó, báo kết quả, làm mới mọi nơi đang
   * hiện phiếu. Đóng hộp hỏi mã = huỷ, không phải lỗi.
   */
  const runOn = async (row: ApprovalRow, work: () => Promise<unknown>, done: string) => {
    setBusyId(row.id);
    try {
      await work();
      toast({ message: t(done) });
      void actions.refresh();
    } catch (error) {
      if (!isStepUpCancelled(error)) toast({ message: errorMessage(error), tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  /**
   * `query` của tab đang xem — lấy MỘT lần rồi rút cả ba trạng thái từ đó. Không có nhánh lỗi
   * thì một API 500 thành mảng rỗng, và người trực đêm đọc ra "không ai đang xin quyền" trong
   * khi phiếu đang nằm đó.
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

  return (
    <>
      <PageHeader
        title={t('approvals.title')}
        subtitle={t('approvals.subtitle')}
        actions={
          /*
            Nút Xuất CHỈ ở tab Nhật ký, vì file luôn là toàn bộ lịch sử — để ở tab khác là người
            đang xem "Chờ duyệt" im lặng nhận cả kho. File không có cột nào chứa secret (FR-026).
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
        {active.isLoading ? (
          <Loading />
        ) : active.isError ? (
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
            {items.map((row) => {
              const own = row.requester.toLowerCase() === myEmail;
              const busy = busyId === row.id;
              return (
                <section
                  key={row.id}
                  className="card device-panel"
                  aria-label={t('approvals.cardLabel', { member: row.requester })}
                  aria-current={row === focused ? 'true' : undefined}
                >
                  <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                    <BreakGlassStateBadge row={row} />
                    {row === focused ? (
                      <span className="badge warn">{t('approvals.fromMail')}</span>
                    ) : null}
                    <strong>{row.requesterName}</strong>
                    {row.requesterName !== row.requester ? (
                      <span className="muted">{row.requester}</span>
                    ) : null}
                    <span className="muted">{formatDateTime(row.createdAt)}</span>
                  </div>

                  {/* Đối tượng NGAY dưới người xin, trước lý do: "máy nào" là câu người duyệt
                      hỏi đầu tiên để đánh giá rủi ro. */}
                  <BreakGlassSubject row={row} />

                  <p className="approval-reason">{row.reason}</p>

                  <dl className="data-grid">
                    <div className="field">
                      <dt className="lbl-t">{t('approvals.asked')}</dt>
                      <dd>
                        {/* "— giờ" là một chỗ trống đội lốt câu trả lời: không biết thì nói
                            không biết. */}
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
                          {/* `active` do SERVER tính bằng đồng hồ (AD-6). */}
                          {!row.active && row.state === 'approved' ? (
                            <span className="cell-sub">{t('approvals.alreadyOver')}</span>
                          ) : null}
                        </dd>
                      </div>
                    ) : null}
                  </dl>

                  <div className="action-cell">
                    {canDecide && row.state === 'pending' && !own ? (
                      <>
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
                      </>
                    ) : null}

                    {/* Phiếu của CHÍNH MÌNH: bốn mắt cấm tự duyệt — nói thẳng thay vì bày nút
                        Duyệt rồi để server từ chối. Ở tab của mình thì rút được. */}
                    {own && row.state === 'pending' && tab === 'pending' ? (
                      <span className="muted">{t('approvals.ownRequest')}</span>
                    ) : null}
                    {own && row.state === 'pending' && tab === 'mine' ? (
                      <button
                        type="button"
                        className="btn sm danger-ghost"
                        disabled={busy}
                        onClick={() => {
                          void (async () => {
                            const ok = await askConfirm({
                              title: t('common.titleOf', {
                                action: t('approvals.cancel'),
                                subject: row.subjectLabel ?? t('approvals.subjectGone'),
                              }),
                              message: t('approvals.confirmCancel'),
                              danger: true,
                              confirmLabel: t('approvals.cancel'),
                            });
                            if (ok) {
                              await runOn(row, () => actions.cancel(row.id), 'approvals.cancelled');
                            }
                          })();
                        }}
                      >
                        {t('approvals.cancel')}
                      </button>
                    ) : null}

                    {canDecide && row.state === 'approved' && row.active ? (
                      <button
                        type="button"
                        className="btn sm danger"
                        disabled={busy}
                        /*
                         * PHẢI hỏi lại: nút này CẮT một quyền ĐANG CHẠY của người khác — có thể
                         * họ đang mở két giữa lúc xử sự cố. Đòi step-up nên đi qua
                         * `actions.revoke` (hỏi mã 6 số khi cần), không gọi API trần.
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
                            if (ok) {
                              await runOn(row, () => actions.revoke(row.id), 'approvals.revoked');
                            }
                          })();
                        }}
                      >
                        {t('approvals.revoke')}
                      </button>
                    ) : null}

                    <Link className="btn sm" to={PATHS.approval(row.id)}>
                      {t('approvals.openDetail')}
                    </Link>
                  </div>
                </section>
              );
            })}
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

      {actions.dialog}

      {deciding ? (
        <DecisionDialog
          row={deciding.row}
          approve={deciding.approve}
          csrfToken={me.csrfToken}
          onClose={() => setDeciding(null)}
          onDone={() => {
            setDeciding(null);
            toast({ message: t(deciding.approve ? 'approvals.approved' : 'approvals.denied') });
          }}
        />
      ) : null}
    </>
  );
}
