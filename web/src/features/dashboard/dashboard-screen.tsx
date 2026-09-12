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
  if (data.isError) return <LoadError onRetry={() => void data.refetch()} />;

  const board = data.data!;

  return (
    <>
      <PageHeader
        title={t('dashboard.title', { name: me.fullName })}
        subtitle={t('dashboard.subtitle')}
      />

      <div className="dashboard">
        <BlockCard
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
        </BlockCard>

        {/*
          Dải nào sắp hết chỗ (FR-020). Câu này trước đây chỉ trả lời được bằng cách mở màn IP
          rồi đọc từng thanh — mà không ai mở màn IP khi chưa có việc.
        */}
        <BlockCard
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
        </BlockCard>

        {/*
          Member KHÔNG nhận khối này từ server (rút gọn theo vai, đúng bằng quyền của
          `GET /vault/owners`) — nên không render gì cả, y như khối break-glass.
        */}
        {board.staleSecrets.available ? (
          <BlockCard
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
          </BlockCard>
        ) : null}

        {/*
          Epic 9 chưa deploy. Khối vẫn HIỆN, nói rõ "phần này chưa có" — giấu đi thì sếp tưởng
          hệ thống đã theo dõi sự cố rồi và tuần qua không có cái nào.
        */}
        <BlockCard
          title={t('dashboard.incidents')}
          total={board.incidents.total}
          available={board.incidents.available}
          emptyText={t('dashboard.incidentsEmpty')}
          unavailableText={t('dashboard.incidentsNotYet')}
        >
          <></>
        </BlockCard>

        {/* Member không nhận khối này từ server (rút gọn theo vai) — nên không render gì cả. */}
        {board.breakGlass.available ? (
          <BlockCard
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
          </BlockCard>
        ) : null}

        {/* Tuần qua công ty bỏ những gì — ba loại gộp sẵn ở module `disposal`, không gộp lại. */}
        <BlockCard
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
        </BlockCard>
      </div>
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
  return (
    <section className="card dash-card">
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

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
