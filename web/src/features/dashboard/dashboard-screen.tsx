import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import {
  BREAK_GLASS_KEY,
  BreakGlassSubject,
  DecisionDialog,
  type BreakGlassRow,
} from '@/ui/break-glass';
import { useToast } from '@/ui/toast';
import { formatDate, formatDateTime } from '@/lib/format';
import type { Me } from '@/lib/me';
import { DataTable } from '@/ui/data-table';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { RenewDialog } from '@/ui/renew-dialog';
import { KpiStrip, KpiTile } from '@/ui/kpi-strip';
import { LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { OWNER_PATH, PATHS } from '@/lib/routes';
import { UsageBar } from '@/ui/usage-bar';
import { DISPOSAL_KIND_KEY, type DisposalKind } from '@/lib/disposal-kinds';
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
  subjectLabel: string;
  reason: string;
  state: string;
  decidedBy: string | null;
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
  expiring: Block<ExpiringItem>;
  incidents: Block<never>;
  breakGlass: Block<BreakGlassItem>;
  subnetLoad: Block<SubnetLoadItem>;
  staleSecrets: Block<StaleSecretItem>;
  disposed: Block<DisposedItem>;
}

/**
 * Bảng điều khiển (story 7.1, FR-025).
 *
 * Mục tiêu của epic viết rất cụ thể: "sếp 3 phút sáng thứ Hai tự trả lời mọi câu hỏi". Nên
 * trang này KHÔNG có bộ lọc, không có phân trang, không có gì để bấm trước khi đọc được —
 * mở ra là thấy. Muốn đào sâu thì có đường dẫn sang màn đầy đủ ở cuối mỗi khối.
 */
export function DashboardScreen({ me }: { me: Me }) {
  const { t } = useTranslation();

  const data = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiFetch<Dashboard>('/api/v1/dashboard'),
  });

  /*
   * PHẢI gọi TRƯỚC hai lệnh `return` sớm bên dưới — hook không được nằm sau một nhánh thoát,
   * nếu không thứ tự hook đổi giữa các lượt render và React đổ.
   *
   * Dùng chung `queryKey` với màn `/expiry` nên đây không phải một lượt gọi mới: react-query
   * gộp và chia cache. Và cố ý KHÔNG chặn màn khi nó hỏng — nhãn loại hạn là thứ trang trí
   * cho một dòng, mất nó không đáng làm cả bảng điều khiển trắng xóa.
   */
  const kinds = useExpiryKinds();

  if (data.isLoading) return <Loading />;
  if (data.isError) return <LoadError error={data.error} onRetry={() => void data.refetch()} />;

  // Mất mạng ⇒ `fetchStatus:'paused'` ⇒ `isLoading` false, `isError` false, `data` undefined:
  // hai nhánh trên đều trượt. Xem chú thích đầy đủ ở `devices/device-detail.tsx` (lỗi F-02).
  if (!data.data) return <Loading />;
  const board = data.data;

  /*
   * HAI NHÓM, không còn sáu ô ngang hàng.
   *
   * Khối đang có việc (`total > 0`) mới được chiếm một ô trong lưới. Khối đang YÊN — "chưa dải
   * nào chạm ngưỡng", "tuần qua không ai xin quyền xem tạm thời" — và khối chưa mở thì gom
   * xuống một dải mỏng ở chân trang, mỗi khối một dòng.
   *
   * VÌ SAO. Lượt chụp đầu của bản này cho thấy ba câu TIN TỐT chiếm ba ô to ngang với ô "Sắp
   * hết hạn" đang có 8 dòng; lưới căn theo hàng nên hai cột bên phải bỏ trống gần hết chiều
   * cao màn hình. Tin tốt vẫn phải nói ra — im lặng thì không phân biệt được với "chưa đo bao
   * giờ" — nhưng nó không đáng một ô, vì con số 0 trên hàng KPI đã là chỗ đọc nhanh của nó.
   */
  /*
   * HAI LÀN CỐ ĐỊNH, không phải lưới theo hàng.
   *
   * Lưới căn theo hàng thì khối thứ tư rơi xuống dưới đáy khối cao nhất của hàng trên, và cột
   * bên cạnh bỏ trống cả trăm pixel. Nên: làn chính (2 phần) cho khối "Sắp hết hạn" — danh sách
   * dài nhất; làn phụ (1 phần) xếp chồng các khối nhỏ theo độ ưu tiên (số nhỏ đứng trên). Lịch
   * sử break-glass đứng cuối làn phụ: việc CẦN LÀM đã lên khối "Cần bạn duyệt" ở đầu trang.
   */
  const main: ReactNode[] = [];
  const side: { rank: number; node: ReactNode }[] = [];
  const quiet: ReactNode[] = [];
  const place = (block: Block<unknown>, node: ReactNode, lane: 'main' | number) => {
    if (isQuiet(block)) quiet.push(node);
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
    >
      <ExpiringTable items={board.expiring.items} kinds={kinds.data} me={me} />
    </BlockCard>,
    'main',
  );

  /*
    Dải nào sắp hết chỗ (FR-020). Câu này trước đây chỉ trả lời được bằng cách mở màn IP
    rồi đọc từng thanh — mà không ai mở màn IP khi chưa có việc.
  */
  place(
    board.subnetLoad,
    <BlockCard
      key="subnetLoad"
      title={t('dashboard.subnetLoad')}
      total={board.subnetLoad.total}
      available={board.subnetLoad.available}
      moreTo={PATHS.ipAddresses}
      moreLabel={t('dashboard.seeAllSubnets')}
      emptyText={t('dashboard.subnetLoadEmpty')}
      unavailableText={t('dashboard.blockError')}
    >
      <ul className="dash-list">
        {board.subnetLoad.items.map((item) => (
          <li key={item.id}>
            <div className="dash-line">
              <Link to={PATHS.subnet(item.id)}>{item.name}</Link>
              <span className="mono muted">{item.cidr}</span>
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
            />
          </li>
        ))}
      </ul>
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
      >
        <ul className="dash-list">
          {board.breakGlass.items.map((item) => (
            <li key={item.id}>
              <div className="dash-line">
                <strong>{item.requester}</strong>
                <span className="badge muted">{t(`approvals.state${cap(item.state)}`, item.state)}</span>
              </div>
              <span>{item.subjectLabel}</span>
              <span className="muted">{item.reason}</span>
              <span className="muted">
                {formatDateTime(item.createdAt)}
                {item.decidedBy ? ` · ${t('dashboard.by', { who: item.decidedBy })}` : ''}
              </span>
            </li>
          ))}
        </ul>
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
      >
        <ul className="dash-list">
          {board.staleSecrets.items.map((item) => (
            <li key={`${item.ownerType}-${item.ownerId}`}>
              <div className="dash-line">
                <Link to={OWNER_PATH[item.ownerType](item.ownerId)}>{item.code}</Link>
                <span className="badge muted">
                  {t('dashboard.secretCount', { count: item.secretCount })}
                </span>
              </div>
              <span>{item.name}</span>
              <span className="muted">
                {t('dashboard.staleSince', {
                  date: formatDate(item.lastChangeAt),
                  days: item.daysSince,
                })}
              </span>
            </li>
          ))}
        </ul>
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
    >
      <ul className="dash-list">
        {board.disposed.items.map((item) => (
          <li key={`${item.kind}-${item.id}`}>
            <div className="dash-line">
              {/* Vẫn mở được hồ sơ gốc: "đã thanh lý" không phải "đã xóa". */}
              <Link to={OWNER_PATH[item.kind](item.id)}>{item.code}</Link>
              <span className="badge plain">{t(DISPOSAL_KIND_KEY[item.kind])}</span>
            </div>
            <span>{item.name}</span>
            <span className="muted">
              {item.detail ? `${item.detail} · ` : ''}
              {item.updatedAt ? formatDate(item.updatedAt) : ''}
            </span>
          </li>
        ))}
      </ul>
    </BlockCard>,
    3,
  );

  /*
    Epic 9 chưa deploy. Khối vẫn HIỆN và vẫn nói thẳng "phần này chưa có" — giấu đi thì sếp
    tưởng hệ thống đã theo dõi sự cố rồi và tuần qua không có cái nào. Nó rơi vào nhóm YÊN
    theo đúng luật chung (`available: false`), nên không phải khai riêng một ngoại lệ.
  */
  place(
    board.incidents,
    <BlockCard
      key="incidents"
      title={t('dashboard.incidents')}
      total={board.incidents.total}
      available={board.incidents.available}
      emptyText={t('dashboard.incidentsEmpty')}
      unavailableText={t('dashboard.incidentsNotYet')}
    >
      <></>
    </BlockCard>,
    5,
  );

  return (
    <>
      <PageHeader
        title={t('dashboard.title', { name: me.fullName })}
        subtitle={t('dashboard.subtitle')}
      />

      {/* Việc gấp nhất của người duyệt trên điện thoại đứng ĐẦU trang, trên cả hàng số. */}
      <NeedsYouBlock me={me} />

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
      {quiet.length > 0 ? <div className="dash-quiet">{quiet}</div> : null}
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
  const rows = (pending.data ?? []).filter((row) => row.requester.toLowerCase() !== mine);
  if (!canDecide || rows.length === 0) return null;

  return (
    <section className="card dash-card dash-needs-you" aria-label={t('dashboard.needsYou', { count: rows.length })}>
      <h2 className="form-section-title">{t('dashboard.needsYou', { count: rows.length })}</h2>
      <ul className="dash-list">
        {rows.map((row) => (
          <li key={row.id}>
            <div className="dash-line">
              <strong>{row.requesterName}</strong>
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
 * Hàng số ở đầu trang — cùng những con số đã có, đặt ở chỗ đọc được.
 *
 * VÌ SAO. Mỗi khối vốn đã mang `total` của nó, nhưng nó nằm trong một cái pill 11px cạnh tiêu
 * đề: muốn biết "sáng nay có gì gấp" thì phải quét mắt qua sáu cái thẻ cao thấp khác nhau rồi
 * tự cộng. Mục tiêu của epic là ba phút; ba phút đó phải bắt đầu bằng MỘT hàng số.
 *
 * KHÔNG có số liệu mới ở đây: mỗi ô đúng bằng `total` của khối ngay bên dưới, và ô nào thuộc
 * khối server đã cắt theo vai (`available: false`) thì cũng biến mất theo — Member thấy ba ô,
 * SA thấy năm. Cắt ở cùng một chỗ với khối thì không thể lệch nhau.
 *
 * Chỉ HAI ô được tô màu: "sắp hết hạn" và "dải mạng sắp đầy" — hai thứ đến hạn mà không ai
 * làm gì thì hỏng việc thật. Tô cả năm ô thì không ô nào còn nghĩa.
 */
function BoardKpis({ board }: { board: Dashboard }) {
  const { t } = useTranslation();

  const tiles: { key: string; label: string; total: number; to: string; warn: boolean }[] = [
    board.expiring.available
      ? {
          key: 'expiring',
          label: t('dashboard.kpiExpiring'),
          total: board.expiring.total,
          to: PATHS.expiry,
          warn: true,
        }
      : null,
    board.subnetLoad.available
      ? {
          key: 'subnets',
          label: t('dashboard.kpiSubnets'),
          total: board.subnetLoad.total,
          to: PATHS.ipAddresses,
          warn: true,
        }
      : null,
    board.breakGlass.available
      ? {
          key: 'breakGlass',
          label: t('dashboard.kpiBreakGlass'),
          total: board.breakGlass.total,
          to: PATHS.approvals,
          warn: false,
        }
      : null,
    board.staleSecrets.available
      ? {
          key: 'stale',
          label: t('dashboard.kpiStale'),
          total: board.staleSecrets.total,
          to: PATHS.vault,
          warn: false,
        }
      : null,
    board.disposed.available
      ? {
          key: 'disposed',
          label: t('dashboard.kpiDisposed'),
          total: board.disposed.total,
          to: PATHS.disposal,
          warn: false,
        }
      : null,
  ].filter((tile): tile is NonNullable<typeof tile> => tile !== null);

  if (tiles.length === 0) return null;

  return (
    <>
      <KpiStrip>
        {tiles.map((tile) => (
          <KpiTile
            key={tile.key}
            value={tile.total}
            label={tile.label}
            tone={tile.warn ? 'warn' : undefined}
            to={tile.to}
          />
        ))}
      </KpiStrip>
      {tiles.every((tile) => tile.total === 0) ? (
        <p className="dash-calm">{t('dashboard.kpiCalm')}</p>
      ) : null}
    </>
  );
}

/**
 * Một khối có BA trạng thái, và cả ba phải nói ba câu khác nhau:
 *  - chưa có phần này (module chưa deploy / khối lỗi)
 *  - có phần này, tuần qua không có gì
 *  - có dữ liệu
 *
 * Gộp hai cái đầu thành một ô trống là cách nhanh nhất để sếp yên tâm nhầm.
 */
function BlockCard({
  title,
  total,
  available,
  moreTo,
  moreLabel,
  emptyText,
  unavailableText,
  children,
}: {
  title: string;
  total: number;
  available: boolean;
  moreTo?: string;
  moreLabel?: string;
  emptyText: string;
  unavailableText: string;
  children: React.ReactNode;
}) {
  /* Không có gì để liệt kê thì không có gì để xếp hàng: thu về một dòng. Cùng MỘT vị từ với
     chỗ chia hai nhóm ở trên, nên hình dạng thẻ và chỗ nó đứng không bao giờ lệch nhau. */
  const slim = isQuiet({ available, total });

  return (
    <section className={`card dash-card${slim ? ' slim' : ''}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 className="form-section-title">{title}</h2>
        {available && total > 0 ? <span className="badge">{total}</span> : null}
      </div>

      {!available ? (
        <p className="muted">{unavailableText}</p>
      ) : total === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <>
          {children}
          {moreTo ? (
            <Link className="btn sm" to={moreTo}>
              {moreLabel}
            </Link>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * Khối "Sắp hết hạn" dạng bảng gọn: Đối tượng · Loại · Hết hạn · Còn lại · [Gia hạn].
 *
 * Bảng chứ không phải danh sách hai dòng: đây là khối ở làn chính, câu hỏi của nó là "cái gì,
 * loại gì, còn bao lâu" — đọc theo cột nhanh hơn đọc từng cụm. Gia hạn ngay trên dòng dùng
 * CÙNG hộp với màn `/expiry` (`ui/renew-dialog.tsx`); nút chỉ hiện khi module expiry nói dòng
 * đó gia hạn được. ≤600px bảng thành thẻ gọn (`mobileCard`), vẫn có nút Gia hạn.
 */
function ExpiringTable({
  items,
  kinds,
  me,
}: {
  items: ExpiringItem[];
  kinds: ExpiryKind[] | undefined;
  me: Me;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [renewing, setRenewing] = useState<ExpiringItem | null>(null);

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

  return (
    <>
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
          aside: (item) =>
            item.canRenew ? <RenewButton item={item} onRenew={setRenewing} /> : null,
        }}
      />
      {renewing ? (
        <RenewDialog
          row={{ ...renewing, end: renewing.endDate }}
          kindLabel={expiryKindLabel(kinds, renewing.kind)}
          csrfToken={me.csrfToken}
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

/**
 * Khối "đang yên": không tải được, hoặc tải được mà không có dòng nào.
 *
 * Hai cảnh đó nói hai câu KHÁC nhau (và `BlockCard` vẫn nói đúng hai câu), nhưng về mặt bố cục
 * chúng giống nhau: một dòng chữ, không có gì để xếp thành cột.
 */
function isQuiet(block: { available: boolean; total: number }): boolean {
  return !block.available || block.total === 0;
}

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
