import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import {
  BREAK_GLASS_KEY,
  BreakGlassStateBadge,
  BreakGlassSubject,
  DecisionDialog,
  type BreakGlassRow,
} from '@/ui/break-glass';
import { useToast } from '@/ui/toast';
import { formatDate, formatDateTime } from '@/lib/format';
import type { Me } from '@/lib/me';
import type { SecretOwnerType } from '@/lib/secret-owner-kinds';
import { DataTable } from '@/ui/data-table';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { RenewDialog } from '@/ui/renew-dialog';
import { KpiStrip, KpiTile } from '@/ui/kpi-strip';
import { LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { OWNER_PATH, PATHS } from '@/lib/routes';
import { UsageBar } from '@/ui/usage-bar';
import { useMediaQuery } from '@/ui/use-media-query';
import { DISPOSAL_KIND_KEY, disposalDetailText, type DisposalKind } from '@/lib/disposal-kinds';
import { expiryKindLabel, useExpiryKinds, type ExpiryKind } from '@/lib/expiry-kinds';

interface Block<T> {
  available: boolean;
  items: T[];
  total: number;
}

interface ExpiringItem {
  kind: string;
  id: string;
  label: string;
  endDate: string;
  daysLeft: number;
  link: string | null;
  canRenew: boolean;
}

interface BreakGlassItem {
  id: string;
  requester: string;
  requesterName?: string;
  subjectType: SecretOwnerType;
  subjectId: string;
  subjectLabel: string | null;
  reason: string;
  state: string;
  active?: boolean;
  decidedBy: string | null;
  decidedByName?: string | null;
  createdAt: string;
  expiresAt: string | null;
}

interface SubnetLoadItem {
  id: string;
  name: string;
  cidr: string;
  vlan: number | null;
  used: number;
  total: number;
  free: number;
  percent: number;
}

interface StaleSecretItem {
  ownerType: keyof typeof OWNER_PATH;
  ownerId: string;
  code: string;
  name: string;
  secretCount: number;
  lastChangeAt: string;
  daysSince: number;
}

interface DisposedItem {
  kind: DisposalKind;
  id: string;
  code: string;
  name: string;
  detail: string | null;
  updatedAt: string | null;
}

interface Dashboard {
  expiring: Block<ExpiringItem> & { overdueTotal?: number };
  incidents: Block<never>;
  breakGlass: Block<BreakGlassItem>;
  subnetLoad: Block<SubnetLoadItem> & { thresholdPercent?: number | null };
  staleSecrets: Block<StaleSecretItem>;
  disposed: Block<DisposedItem>;
}

/** Trên điện thoại mỗi khối chỉ bày chừng này mục, phần còn lại bung tại chỗ. */
const MOBILE_ITEMS = 3;
const MOBILE_QUERY = '(max-width: 600px)';

/**
 * Bảng điều khiển (story 7.1, FR-025).
 *
 * Mục tiêu của epic viết rất cụ thể: "sếp 3 phút sáng thứ Hai tự trả lời mọi câu hỏi". Nên
 * trang này KHÔNG có bộ lọc, không có phân trang, không có gì để bấm trước khi đọc được —
 * mở ra là thấy. Muốn đào sâu thì có đường dẫn sang màn đầy đủ ở cuối mỗi khối.
 *
 * Đầu trang LUÔN có mặt, kể cả lúc đang tải hay lỗi: mất cả tiêu đề thì trên điện thoại người
 * dùng không biết mình đang ở trang nào.
 */
export function DashboardScreen({ me }: { me: Me }) {
  const { t } = useTranslation();

  const data = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiFetch<Dashboard>('/api/v1/dashboard'),
    // Tab để mở từ sáng: quay lại tab là số liệu tự làm mới, khỏi đọc số cũ.
    refetchOnWindowFocus: true,
  });

  /*
   * Dùng chung `queryKey` với màn `/expiry` nên đây không phải một lượt gọi mới: react-query
   * gộp và chia cache. Và cố ý KHÔNG chặn màn khi nó hỏng — nhãn loại hạn là thứ trang trí
   * cho một dòng, mất nó không đáng làm cả bảng điều khiển trắng xóa.
   */
  const kinds = useExpiryKinds();

  const header = (
    <PageHeader
      title={t('dashboard.title')}
      subtitle={
        data.dataUpdatedAt
          ? t('dashboard.greetingAt', {
              name: me.fullName,
              time: formatDateTime(new Date(data.dataUpdatedAt).toISOString()),
            })
          : t('dashboard.greeting', { name: me.fullName })
      }
      actions={
        <button
          type="button"
          className="ghost"
          onClick={() => void data.refetch()}
          disabled={data.isFetching}
        >
          {data.isFetching ? t('app.loading') : t('dashboard.refresh')}
        </button>
      }
    />
  );

  // Mất mạng ⇒ `fetchStatus:'paused'` ⇒ `isLoading` false, `isError` false, `data` undefined:
  // chỉ đọc `isLoading` là trượt. Xem chú thích đầy đủ ở `devices/device-detail.tsx` (lỗi F-02).
  if (data.isError) {
    return (
      <>
        {header}
        <LoadError error={data.error} onRetry={() => void data.refetch()} />
      </>
    );
  }
  if (!data.data) {
    return (
      <>
        {header}
        <Loading />
      </>
    );
  }
  const board = data.data;
  const retry = () => void data.refetch();

  /*
   * HAI LÀN CỐ ĐỊNH, không phải lưới theo hàng.
   *
   * Khối đang có việc (`total > 0`) mới được chiếm chỗ: làn chính (2 phần) cho khối hạn — danh
   * sách dài nhất; làn phụ (1 phần) xếp chồng các khối nhỏ theo độ ưu tiên (số nhỏ đứng trên).
   * Khối đang YÊN, khối lỗi và khối chưa có thì gom xuống dải mỏng ở chân trang, mỗi khối một
   * dòng — lỗi đứng ĐẦU dải để không lẫn vào tin tốt.
   */
  const main: ReactNode[] = [];
  const side: { rank: number; node: ReactNode }[] = [];
  const quiet: { rank: number; node: ReactNode }[] = [];
  const place = (block: Block<unknown>, node: ReactNode, lane: 'main' | number) => {
    if (!block.available) quiet.push({ rank: 0, node });
    else if (block.total === 0) quiet.push({ rank: 1, node });
    else if (lane === 'main') main.push(node);
    else side.push({ rank: lane, node });
  };

  place(
    board.expiring,
    <BlockCard
      key="expiring"
      title={t('dashboard.expiring')}
      total={board.expiring.total}
      available={board.expiring.available}
      moreTo={PATHS.expiry}
      moreLabel={t('dashboard.seeAllExpiring')}
      emptyText={t('dashboard.expiringEmpty')}
      unavailableText={t('dashboard.blockError')}
      onRetry={retry}
    >
      <ExpiringBlock board={board.expiring} kinds={kinds.data} me={me} />
    </BlockCard>,
    'main',
  );

  /* Dải nào sắp hết chỗ (FR-020) — không ai mở màn IP khi chưa có việc. */
  const threshold = board.subnetLoad.thresholdPercent ?? null;
  place(
    board.subnetLoad,
    <BlockCard
      key="subnetLoad"
      title={
        threshold !== null
          ? t('dashboard.subnetLoadAt', { percent: threshold })
          : t('dashboard.subnetLoad')
      }
      total={board.subnetLoad.total}
      available={board.subnetLoad.available}
      moreTo={PATHS.ipAddresses}
      moreLabel={t('dashboard.seeAllSubnets')}
      emptyText={t('dashboard.subnetLoadEmpty')}
      unavailableText={t('dashboard.blockError')}
      onRetry={retry}
    >
      <MobileLimited
        items={board.subnetLoad.items}
        render={(item) => (
          <li key={item.id}>
            <div className="dash-subnet">
              <Link to={PATHS.subnet(item.id)}>{item.name}</Link>
              {item.vlan !== null ? (
                <span className="muted">{t('ipam.vlanBadge', { vlan: item.vlan })}</span>
              ) : null}
              <span className="mono">{item.cidr}</span>
            </div>
            {/*
              Kèm `used/total · còn free` chứ không chỉ phần trăm: 95% của một /26 là còn 3
              chỗ, 95% của một /24 là còn 12 — hai mức khẩn khác hẳn nhau, cùng một con số.
            */}
            <UsageBar
              percent={item.percent}
              label={t('dashboard.subnetUsage', {
                used: item.used,
                total: item.total,
                free: item.free,
              })}
              ariaLabel={t('dashboard.subnetUsageAria', { name: item.name })}
              marker={
                threshold !== null
                  ? { percent: threshold, label: t('dashboard.subnetThreshold', { percent: threshold }) }
                  : undefined
              }
            />
          </li>
        )}
      />
    </BlockCard>,
    1,
  );

  /* Member không nhận khối này từ server (rút gọn theo vai) — nên không render gì cả. */
  if (board.breakGlass.available) {
    place(
      board.breakGlass,
      <BlockCard
        key="breakGlass"
        title={t('dashboard.breakGlass')}
        total={board.breakGlass.total}
        available
        moreTo={PATHS.approvals}
        moreLabel={t('dashboard.seeAllBreakGlass')}
        emptyText={t('dashboard.breakGlassEmpty')}
        unavailableText={t('dashboard.blockError')}
        onRetry={retry}
      >
        <MobileLimited
          items={board.breakGlass.items}
          render={(item) => <BreakGlassLine key={item.id} item={item} />}
        />
      </BlockCard>,
      4,
    );
  }

  /*
    Member KHÔNG nhận khối này từ server (rút gọn theo vai, đúng bằng quyền của
    `GET /vault/owners`) — nên không render gì cả, y như khối break-glass.
  */
  if (board.staleSecrets.available) {
    place(
      board.staleSecrets,
      <BlockCard
        key="staleSecrets"
        title={t('dashboard.staleSecrets')}
        total={board.staleSecrets.total}
        available
        moreTo={PATHS.vault}
        moreLabel={t('dashboard.seeAllVault')}
        emptyText={t('dashboard.staleSecretsEmpty')}
        unavailableText={t('dashboard.blockError')}
        onRetry={retry}
      >
        <MobileLimited
          items={board.staleSecrets.items}
          render={(item) => (
            <li key={`${item.ownerType}-${item.ownerId}`}>
              <div className="dash-line">
                <span className="dash-line-name">
                  <Link to={OWNER_PATH[item.ownerType](item.ownerId)}>{item.code}</Link>
                  <span className="dash-line-sub">{item.name}</span>
                </span>
                <span className="badge muted">
                  {t('dashboard.secretCount', { count: item.secretCount })}
                </span>
              </div>
              <span className="muted">
                {t('dashboard.staleSince', {
                  date: formatDate(item.lastChangeAt),
                  days: item.daysSince,
                })}
              </span>
            </li>
          )}
        />
      </BlockCard>,
      2,
    );
  }

  /* Tuần qua công ty bỏ những gì — các loại gộp sẵn ở module `disposal`, không gộp lại. */
  place(
    board.disposed,
    <BlockCard
      key="disposed"
      title={t('dashboard.disposed')}
      total={board.disposed.total}
      available={board.disposed.available}
      moreTo={PATHS.disposal}
      moreLabel={t('dashboard.seeAllDisposed')}
      emptyText={t('dashboard.disposedEmpty')}
      unavailableText={t('dashboard.blockError')}
      onRetry={retry}
    >
      <MobileLimited
        items={board.disposed.items}
        render={(item) => {
          const detail = disposalDetailText(item.kind, item.detail, t);
          return (
            <li key={`${item.kind}-${item.id}`}>
              <div className="dash-line">
                <span className="dash-line-name">
                  {/* Vẫn mở được hồ sơ gốc: "đã thanh lý" không phải "đã xóa". */}
                  <Link to={OWNER_PATH[item.kind](item.id)}>{item.code}</Link>
                  <span className="dash-line-sub">{item.name}</span>
                </span>
                <span className="badge muted">{t(DISPOSAL_KIND_KEY[item.kind])}</span>
              </div>
              <span className="muted">
                {[detail, item.updatedAt ? formatDate(item.updatedAt) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          );
        }}
      />
    </BlockCard>,
    3,
  );

  /*
    Module sự cố chưa có. Khối vẫn HIỆN và nói thẳng "chưa theo dõi" — giấu đi thì sếp tưởng
    hệ thống đã theo dõi sự cố rồi và tuần qua không có cái nào. Tông THÔNG TIN, không phải
    tông lỗi: nó không hỏng, chỉ là chưa có.
  */
  quiet.push({
    rank: 2,
    node: (
      <BlockCard
        key="incidents"
        title={t('dashboard.incidents')}
        total={board.incidents.total}
        available={board.incidents.available}
        notYet
        emptyText={t('dashboard.incidentsEmpty')}
        unavailableText={t('dashboard.incidentsNotYet')}
      >
        <></>
      </BlockCard>
    ),
  });

  return (
    <>
      {header}

      {/* Việc gấp nhất của người duyệt trên điện thoại đứng ĐẦU trang, trên cả hàng số. */}
      <NeedsYouBlock me={me} />
      {/* Người XIN mở két: "đã được duyệt chưa, còn hiệu lực bao lâu" — đứng đầu khi có việc. */}
      <MyRequestsBlock />

      <BoardKpis board={board} />

      {main.length + side.length > 0 ? (
        <div className={main.length > 0 && side.length > 0 ? 'dash-lanes' : 'dash-lanes single'}>
          {main.length > 0 ? (
            <div className="dash-lane" data-testid="dash-lane-main">
              {main}
            </div>
          ) : null}
          {side.length > 0 ? (
            <div className="dash-lane" data-testid="dash-lane-side">
              {side.sort((a, b) => a.rank - b.rank).map((entry) => entry.node)}
            </div>
          ) : null}
        </div>
      ) : null}
      {quiet.length > 0 ? (
        <div className="dash-quiet">
          {quiet.sort((a, b) => a.rank - b.rank).map((entry) => entry.node)}
        </div>
      ) : null}
    </>
  );
}

/** Một dòng break-glass: TÊN người xin, đối tượng dạng link, trạng thái có màu, hiệu lực. */
function BreakGlassLine({ item }: { item: BreakGlassItem }) {
  const { t } = useTranslation();
  const decider = item.decidedByName ?? item.decidedBy;
  return (
    <li>
      <div className="dash-line">
        <strong className="dash-line-name" title={item.requester}>
          {item.requesterName ?? item.requester}
        </strong>
        <BreakGlassStateBadge row={{ state: item.state, active: item.active ?? false }} />
      </div>
      <BreakGlassSubject
        row={{
          subjectType: item.subjectType,
          subjectId: item.subjectId,
          subjectLabel: item.subjectLabel,
          secretCount: null,
        }}
      />
      <span className="muted">{item.reason}</span>
      <span className="muted dash-meta">
        {[
          formatDateTime(item.createdAt),
          decider ? t('dashboard.by', { who: decider }) : null,
          item.active && item.expiresAt
            ? t('dashboard.validUntil', { time: formatDateTime(item.expiresAt) })
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </li>
  );
}

/**
 * Danh sách của một khối: trên điện thoại chỉ bày vài mục đầu + "Xem thêm N" bung tại chỗ —
 * trang chủ trên điện thoại dài 2700px thì không ai cuộn tới khối cuối.
 */
function MobileLimited<T>({ items, render }: { items: T[]; render: (item: T) => ReactNode }) {
  const { t } = useTranslation();
  const narrow = useMediaQuery(MOBILE_QUERY);
  const [all, setAll] = useState(false);
  const cut = narrow && !all && items.length > MOBILE_ITEMS;
  return (
    <>
      <ul className="dash-list">{(cut ? items.slice(0, MOBILE_ITEMS) : items).map(render)}</ul>
      {cut ? (
        <button type="button" className="ghost sm dash-more" onClick={() => setAll(true)}>
          {t('dashboard.showMore', { count: items.length - MOBILE_ITEMS })}
        </button>
      ) : null}
    </>
  );
}

/**
 * "Cần bạn duyệt (N)" — yêu cầu mở két đang chờ CHÍNH người này quyết.
 *
 * Khối lịch sử break-glass trộn phiếu đang chờ với phiếu đã xong và không có nút nào; trên điện
 * thoại nó nằm sau ba màn cuộn. Đây là việc gấp nhất của người duyệt, nên nó đứng đầu trang và
 * có nút ngay tại chỗ (cùng hộp quyết định, cùng luồng step-up với màn Duyệt yêu cầu). Không có
 * gì chờ thì khối biến mất — tin tốt đã nằm ở hàng số bên dưới.
 *
 * Phiếu của chính mình không đếm: bốn mắt (FR-023) cấm tự duyệt.
 */
function NeedsYouBlock({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const canDecide = me.role === 'sa' || me.role === 'admin';
  const [deciding, setDeciding] = useState<{ row: BreakGlassRow; approve: boolean } | null>(null);

  const pending = useQuery({
    queryKey: [...BREAK_GLASS_KEY, 'pending'],
    queryFn: () => apiFetch<BreakGlassRow[]>('/api/v1/vault/break-glass/pending'),
    enabled: canDecide,
  });

  const mine = me.email.toLowerCase();
  const rows = (Array.isArray(pending.data) ? pending.data : []).filter(
    (row) => row.requester.toLowerCase() !== mine,
  );
  if (!canDecide || rows.length === 0) return null;

  return (
    <section className="card dash-card dash-needs-you" aria-label={t('dashboard.needsYou', { count: rows.length })}>
      <div className="card-head">
        <h2>{t('dashboard.needsYou', { count: rows.length })}</h2>
      </div>
      <ul className="dash-list">
        {rows.map((row) => (
          <li key={row.id}>
            <div className="dash-line">
              <strong className="dash-line-name">{row.requesterName}</strong>
              <span className="muted">
                {t('dashboard.askedAt', {
                  at: formatDateTime(row.createdAt),
                  hours:
                    row.payload?.hours === undefined
                      ? t('approvals.hoursUnknown')
                      : t('approvals.hours', { hours: row.payload.hours }),
                })}
              </span>
            </div>
            <BreakGlassSubject row={row} />
            <p className="approval-reason">{row.reason}</p>
            <div className="action-cell">
              <button
                type="button"
                className="btn sm primary"
                onClick={() => setDeciding({ row, approve: true })}
              >
                {t('approvals.approve')}
              </button>
              <button
                type="button"
                className="btn sm danger-ghost"
                onClick={() => setDeciding({ row, approve: false })}
              >
                {t('approvals.deny')}
              </button>
              <Link to={PATHS.approval(row.id)}>{t('approvals.openDetail')}</Link>
            </div>
          </li>
        ))}
      </ul>

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
    </section>
  );
}

/**
 * "Yêu cầu mở két của tôi" — cho MỌI vai, chỉ khi có yêu cầu đang chờ hoặc đang còn hiệu lực.
 *
 * Việc người xin quan tâm nhất ngay sau khi gửi là "đã được duyệt chưa, còn bao lâu". Trước đó
 * muốn biết thì phải vào màn Duyệt yêu cầu. Đọc từ `GET /break-glass/mine` sẵn có — không cửa mới.
 */
function MyRequestsBlock() {
  const { t } = useTranslation();
  const mine = useQuery({
    queryKey: [...BREAK_GLASS_KEY, 'mine', 'dashboard'],
    queryFn: () =>
      apiFetch<{ items: BreakGlassRow[] }>('/api/v1/vault/break-glass/mine?page=1&limit=10'),
  });
  const items = Array.isArray(mine.data?.items) ? mine.data.items : [];
  const live = items.filter((row) => row.state === 'pending' || row.active);
  if (live.length === 0) return null;
  return (
    <section className="card dash-card" aria-label={t('dashboard.myRequests')}>
      <div className="card-head">
        <h2>{t('dashboard.myRequests')}</h2>
        <span className="card-head-count">{t('dashboard.itemsCount', { count: live.length })}</span>
      </div>
      <ul className="dash-list">
        {live.map((row) => (
          <li key={row.id}>
            <div className="dash-line">
              <span className="dash-line-name">
                <BreakGlassSubject row={row} />
              </span>
              <BreakGlassStateBadge row={row} />
            </div>
            <span className="muted dash-meta">
              {[
                t('dashboard.sentAt', { time: formatDateTime(row.createdAt) }),
                row.active && row.expiresAt
                  ? t('dashboard.validUntil', { time: formatDateTime(row.expiresAt) })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <Link to={PATHS.approval(row.id)}>{t('approvals.openDetail')}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Hàng số ở đầu trang — việc PHÂN LOẠI, không lặp lại số đếm của khối bên dưới.
 *
 * Hạn tách hai ô: "Đã quá hạn" (tông đỏ — xử lý ngay) và "Sắp hết hạn" (tông cam — lên kế
 * hoạch). Cộng chung một con số thì không ai biết sáng nay phải làm gì trước. Ô nào thuộc khối
 * server đã cắt theo vai (`available: false`) thì cũng biến mất theo — cắt ở cùng một chỗ với
 * khối thì không thể lệch nhau.
 *
 * Chỉ ô có VIỆC PHẢI LÀM mới được tô màu. Tô cả hàng thì không ô nào còn nghĩa.
 */
function BoardKpis({ board }: { board: Dashboard }) {
  const { t } = useTranslation();
  const overdue = board.expiring.overdueTotal ?? 0;
  const threshold = board.subnetLoad.thresholdPercent ?? null;

  const tiles: {
    key: string;
    label: string;
    total: number;
    to: string;
    tone?: 'warn' | 'danger';
  }[] = [
    ...(board.expiring.available
      ? [
          {
            key: 'overdue',
            label: t('dashboard.kpiOverdue'),
            total: overdue,
            to: `${PATHS.expiry}?state=expired`,
            tone: 'danger' as const,
          },
          {
            key: 'expiring',
            label: t('dashboard.kpiExpiring'),
            total: Math.max(0, board.expiring.total - overdue),
            to: PATHS.expiry,
            tone: 'warn' as const,
          },
        ]
      : []),
    ...(board.subnetLoad.available
      ? [
          {
            key: 'subnets',
            label:
              threshold !== null
                ? t('dashboard.kpiSubnetsAt', { percent: threshold })
                : t('dashboard.kpiSubnets'),
            total: board.subnetLoad.total,
            to: PATHS.ipAddresses,
            tone: 'warn' as const,
          },
        ]
      : []),
    ...(board.breakGlass.available
      ? [
          {
            key: 'breakGlass',
            label: t('dashboard.kpiBreakGlass'),
            total: board.breakGlass.total,
            to: PATHS.approvals,
          },
        ]
      : []),
    ...(board.staleSecrets.available
      ? [
          {
            key: 'stale',
            label: t('dashboard.kpiStale'),
            total: board.staleSecrets.total,
            to: PATHS.vault,
          },
        ]
      : []),
    ...(board.disposed.available
      ? [
          {
            key: 'disposed',
            label: t('dashboard.kpiDisposed'),
            total: board.disposed.total,
            to: PATHS.disposal,
          },
        ]
      : []),
  ];

  if (tiles.length === 0) return null;

  return (
    <>
      <KpiStrip>
        {tiles.map((tile) => (
          <KpiTile key={tile.key} value={tile.total} label={tile.label} tone={tile.tone} to={tile.to} />
        ))}
      </KpiStrip>
      {tiles.every((tile) => tile.total === 0) ? (
        <p className="dash-calm">{t('dashboard.kpiCalm')}</p>
      ) : null}
    </>
  );
}

/**
 * Một khối có BỐN trạng thái, và mỗi cái nói một câu khác, mang một tông khác:
 *  - không tải được → tông cảnh báo, có Thử lại (đứng đầu dải yên);
 *  - chưa có phần này (`notYet`) → tông thông tin;
 *  - có phần này, không có gì → tin tốt, dấu ✓;
 *  - có dữ liệu.
 *
 * Gộp lỗi với tin tốt thành cùng một dải xám là cách nhanh nhất để sếp yên tâm nhầm.
 */
function BlockCard({
  title,
  total,
  available,
  notYet = false,
  moreTo,
  moreLabel,
  emptyText,
  unavailableText,
  onRetry,
  children,
}: {
  title: string;
  total: number;
  available: boolean;
  notYet?: boolean;
  moreTo?: string;
  moreLabel?: string;
  emptyText: string;
  unavailableText: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const tone = !available ? (notYet ? 'info' : 'error') : total === 0 ? 'good' : null;

  if (tone) {
    return (
      <section className={`card dash-card slim tone-${tone}`}>
        <span className="dash-tone-ic" aria-hidden="true">
          {tone === 'error' ? '!' : tone === 'info' ? 'i' : '✓'}
        </span>
        <h2 className="dash-slim-title">{title}</h2>
        <p>{tone === 'good' ? emptyText : unavailableText}</p>
        {tone === 'error' && onRetry ? (
          <button type="button" className="sm" onClick={onRetry}>
            {t('app.retry')}
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section className="card dash-card">
      <div className="card-head">
        <h2>{title}</h2>
        <span className="card-head-count">{t('dashboard.itemsCount', { count: total })}</span>
      </div>
      {children}
      {moreTo ? (
        <Link className="linkbtn sm dash-see-all" to={moreTo}>
          {moreLabel}
        </Link>
      ) : null}
    </section>
  );
}

/**
 * Khối hạn: HAI nhóm có tiêu đề phụ — "Đã quá hạn (N)" trước, "Sắp tới (M)" sau — mỗi nhóm một
 * bảng gọn Đối tượng · Loại · Hết hạn · Còn lại · [Gia hạn]. Gia hạn ngay trên dòng dùng CÙNG
 * hộp với màn `/expiry` (`ui/renew-dialog.tsx`); nút chỉ hiện khi module expiry nói dòng đó gia
 * hạn được. ≤600px bảng thành thẻ gọn (`mobileCard`), vẫn có nút Gia hạn.
 */
function ExpiringBlock({
  board,
  kinds,
  me,
}: {
  board: Dashboard['expiring'];
  kinds: ExpiryKind[] | undefined;
  me: Me;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [renewing, setRenewing] = useState<ExpiringItem | null>(null);
  const narrow = useMediaQuery(MOBILE_QUERY);
  const [all, setAll] = useState(false);
  // Điện thoại: 3 mục đầu (quá hạn đứng trước) + "Xem thêm N" bung tại chỗ.
  const cut = narrow && !all && board.items.length > MOBILE_ITEMS;
  const visible = cut ? board.items.slice(0, MOBILE_ITEMS) : board.items;

  const overdueItems = visible.filter((item) => item.daysLeft < 0);
  const upcomingItems = visible.filter((item) => item.daysLeft >= 0);
  const overdueTotal = board.overdueTotal ?? board.items.filter((item) => item.daysLeft < 0).length;
  const upcomingTotal = Math.max(0, board.total - overdueTotal);

  const columns = useMemo<ColumnDef<ExpiringItem, unknown>[]>(
    () => [
      {
        id: 'label',
        header: t('dashboard.expiringSubject'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.link ? (
            <Link to={row.original.link}>{row.original.label}</Link>
          ) : (
            row.original.label
          ),
      },
      {
        id: 'kind',
        header: t('expiry.kind'),
        enableSorting: false,
        cell: ({ row }) => expiryKindLabel(kinds, row.original.kind),
      },
      {
        id: 'end',
        header: t('expiry.end'),
        enableSorting: false,
        cell: ({ row }) => formatDate(row.original.endDate),
      },
      {
        id: 'left',
        header: t('dashboard.expiringLeft'),
        enableSorting: false,
        cell: ({ row }) => <ExpiryBadge end={row.original.endDate} />,
      },
      {
        id: 'actions',
        header: t('common.actions'),
        enableSorting: false,
        meta: { className: 'col-center' },
        cell: ({ row }) => <RenewButton item={row.original} onRenew={setRenewing} />,
      },
    ],
    [t, kinds],
  );

  const table = (items: ExpiringItem[]) => (
    <DataTable
      data={items}
      columns={columns}
      emptyText={t('dashboard.expiringEmpty')}
      rowClassName={(item) => (item.daysLeft < 0 ? 'row-danger' : '')}
      mobileCard={{
        title: (item) => item.label,
        href: (item) => item.link ?? undefined,
        badge: (item) => <ExpiryBadge end={item.endDate} />,
        meta: (item) => `${expiryKindLabel(kinds, item.kind)} · ${formatDate(item.endDate)}`,
        aside: (item) => (item.canRenew ? <RenewButton item={item} onRenew={setRenewing} /> : null),
      }}
    />
  );

  return (
    <>
      {overdueItems.length > 0 ? (
        <>
          <h3 className="dash-sub tone-danger">{t('dashboard.expiringOverdue', { count: overdueTotal })}</h3>
          {table(overdueItems)}
        </>
      ) : null}
      {upcomingItems.length > 0 ? (
        <>
          <h3 className="dash-sub">{t('dashboard.expiringUpcoming', { count: upcomingTotal })}</h3>
          {table(upcomingItems)}
        </>
      ) : null}
      {cut ? (
        <button type="button" className="ghost sm dash-more" onClick={() => setAll(true)}>
          {t('dashboard.showMore', { count: board.items.length - MOBILE_ITEMS })}
        </button>
      ) : null}
      {renewing ? (
        <RenewDialog
          row={{ ...renewing, end: renewing.endDate }}
          kindLabel={expiryKindLabel(kinds, renewing.kind)}
          csrfToken={me.csrfToken}
          toastAction={
            renewing.link
              ? {
                  label: t('expiry.openRecordShort'),
                  onClick: () => navigate(renewing.link ?? '/'),
                }
              : undefined
          }
          onClose={() => setRenewing(null)}
          onDone={() => {
            setRenewing(null);
            // Trang chủ và màn `/expiry` cùng đọc một nguồn hạn — làm mới cả hai.
            void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
            void queryClient.invalidateQueries({ queryKey: ['expiry'] });
          }}
        />
      ) : null}
    </>
  );
}

/** Nút Gia hạn của một dòng — không có gì khi module expiry nói dòng đó không gia hạn được. */
function RenewButton({
  item,
  onRenew,
}: {
  item: ExpiringItem;
  onRenew: (item: ExpiringItem) => void;
}) {
  const { t } = useTranslation();
  if (!item.canRenew) return null;
  return (
    <button type="button" className="btn sm" onClick={() => onRenew(item)}>
      {t('expiry.renew')}
    </button>
  );
}
