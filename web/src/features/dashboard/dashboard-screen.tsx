import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { formatDate, formatDateTime } from '@/lib/format';
import type { Me } from '@/lib/me';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';

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

interface Dashboard {
  expiring: Block<ExpiringItem>;
  incidents: Block<never>;
  breakGlass: Block<BreakGlassItem>;
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
          moreTo="/sap-het-han"
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
                  {t(`expiry.kind_${item.kind}`, item.kind)} · {formatDate(item.endDate)}
                </span>
              </li>
            ))}
          </ul>
        </BlockCard>

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
            moreTo="/duyet-yeu-cau"
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
