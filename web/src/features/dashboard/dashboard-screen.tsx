import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { formatDate, formatDateTime } from '@/lib/format';
import type { Me } from '@/lib/me';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { OWNER_PATH, PATHS } from '@/lib/routes';
import { UsageBar } from '@/ui/usage-bar';
import { DISPOSAL_KIND_KEY, type DisposalKind } from '@/lib/disposal-kinds';
import { expiryKindLabel, useExpiryKinds } from '@/lib/expiry-kinds';

interface Block<T> {
  available: boolean;
  items: T[];
  total: number;
}

interface ExpiringItem {
  kind: string;
  label: string;
  endDate: string;
  daysLeft: number;
  link: string | null;
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

  const board = data.data!;

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
  const loud: ReactNode[] = [];
  const quiet: ReactNode[] = [];
  const place = (block: Block<unknown>, node: ReactNode) =>
    (isQuiet(block) ? quiet : loud).push(node);

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
      <ul className="dash-list">
        {board.expiring.items.map((item) => (
          <li key={`${item.kind}-${item.label}-${item.endDate}`}>
            <div className="dash-line">
              {item.link ? <Link to={item.link}>{item.label}</Link> : <span>{item.label}</span>}
              <ExpiryBadge end={item.endDate} />
            </div>
            <span className="muted">
              {expiryKindLabel(kinds.data, item.kind)} · {formatDate(item.endDate)}
            </span>
          </li>
        ))}
      </ul>
    </BlockCard>,
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
    );
  }

  /* Tuần qua công ty bỏ những gì — ba loại gộp sẵn ở module `disposal`, không gộp lại. */
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
  );

  return (
    <>
      <PageHeader
        title={t('dashboard.title', { name: me.fullName })}
        subtitle={t('dashboard.subtitle')}
      />

      <KpiStrip board={board} />

      {loud.length > 0 ? <div className="dashboard">{loud}</div> : null}
      {quiet.length > 0 ? <div className="dash-quiet">{quiet}</div> : null}
    </>
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
function KpiStrip({ board }: { board: Dashboard }) {
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
      <div className="dash-kpis">
        {tiles.map((tile) => (
          <Link
            key={tile.key}
            /* Số 0 KHÔNG bao giờ được tô: "không có gì" là tin tốt, tô vàng lên là báo động giả. */
            className={`kpi${tile.warn && tile.total > 0 ? ' warn' : ''}${tile.total === 0 ? ' zero' : ''}`}
            to={tile.to}
          >
            <span className="kpi-n">{tile.total}</span>
            <span className="kpi-l">{tile.label}</span>
          </Link>
        ))}
      </div>
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
