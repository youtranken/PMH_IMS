import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import type { Me } from '@/lib/me';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { UsageBar } from '@/ui/usage-bar';
import { useToast } from '@/ui/toast';
import { HideDialog, SubnetForm } from './subnet-form';
import { SubnetPane } from './subnet-detail';
import type { SubnetRow } from './ipam-types';

/**
 * Địa chỉ IP (story 5.1, FR-018/FR-020) — MỘT trang hai cột, đúng mockup `body-Ipam.html`:
 * dải mạng ở cột trái, IP của dải đang chọn ở cột phải.
 *
 * Bản dựng đầu tách thành hai trang (`/dia-chi-ip` là bảng dải, `/dia-chi-ip/:id` là bảng IP),
 * và đường đi giữa chúng là mã CIDR gạch chân trong ô đầu bảng. Không ai nhận ra đó là đường
 * vào, nên cả màn trông như "khai được dải mà không khai được IP nào". Hai cột thì chỗ trống
 * và nút "Cấp IP này" nằm ngay cạnh danh sách dải, không phải bấm mò mới thấy.
 *
 * Cả hai đường dẫn cũ đều vào đây: `/dia-chi-ip` chọn sẵn dải đầu tiên, `/dia-chi-ip/:id` chọn
 * đúng dải đó — link cũ vẫn mở được, và mỗi dải vẫn có một địa chỉ riêng để gửi cho nhau.
 */
export function IpamScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id } = useParams();
  const [editing, setEditing] = useState<{ subnet: SubnetRow | null } | null>(null);
  const [hiding, setHiding] = useState<SubnetRow | null>(null);

  const canEdit = me.role === 'sa' || me.role === 'admin';

  const subnets = useQuery({
    queryKey: ['ipam', 'subnets'],
    queryFn: () => apiFetch<SubnetRow[]>('/api/v1/ipam/subnets'),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ipam'] });
  const rows = subnets.data ?? [];
  // Không có `:id` thì mở sẵn dải đầu tiên — mở ra một cột phải trống rỗng rồi bắt người dùng
  // tự bấm một cái nữa là bắt vô cớ. KHÔNG điều hướng: đổi URL sau lưng người dùng làm nút
  // Back của trình duyệt hết đoán được.
  const selected = rows.find((row) => row.id === id) ?? rows[0] ?? null;

  return (
    <>
      <PageHeader
        title={t('ipam.title')}
        subtitle={t('ipam.subtitle')}
        actions={
          <>
            {selected ? (
              <ExportXlsxButton
                url={`/api/v1/ipam/subnets/${selected.id}/export.xlsx`}
                fileName={`ip-${selected.cidr.replace('/', '-')}.xlsx`}
              />
            ) : null}
            {canEdit ? (
              <button
                type="button"
                className="btn primary"
                onClick={() => setEditing({ subnet: null })}
              >
                {t('ipam.addSubnet')}
              </button>
            ) : null}
          </>
        }
      />

      {subnets.isLoading ? (
        <Loading />
      ) : subnets.isError ? (
        <LoadError onRetry={() => void subnets.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('ipam.empty')} hint={t('ipam.emptyHint')} />
      ) : (
        <div className="ipam-split">
          <nav className="subnet-rail" aria-label={t('ipam.railLabel')}>
            <h2 className="form-section-title">{t('ipam.railTitle')}</h2>
            {rows.map((subnet) => (
              <SubnetCard
                key={subnet.id}
                subnet={subnet}
                active={subnet.id === selected?.id}
                canEdit={canEdit}
                onEdit={() => setEditing({ subnet })}
                onHide={() => setHiding(subnet)}
              />
            ))}
          </nav>

          <div className="subnet-pane">
            {selected ? <SubnetPane subnet={selected} me={me} /> : null}
          </div>
        </div>
      )}

      {editing ? (
        <SubnetForm
          subnet={editing.subnet}
          csrfToken={me.csrfToken}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast({ message: t('ipam.subnetSaved') });
            void refresh();
          }}
        />
      ) : null}

      {hiding ? (
        <HideDialog
          subnet={hiding}
          csrfToken={me.csrfToken}
          onClose={() => setHiding(null)}
          onDone={() => {
            setHiding(null);
            toast({ message: t('ipam.subnetHidden') });
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Một thẻ dải ở cột trái.
 *
 * Cả thẻ là một `<Link>` thật, không phải `onClick` trên `<div>`: mở tab mới, copy link, và
 * bàn phím Tab tới được — ba thứ mất sạch nếu dùng div. Hai nút Sửa/Ẩn nằm NGOÀI link (không
 * lồng nút trong link) và chỉ hiện khi có quyền.
 */
function SubnetCard({
  subnet,
  active,
  canEdit,
  onEdit,
  onHide,
}: {
  subnet: SubnetRow;
  active: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onHide: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={`subnet-card${active ? ' is-active' : ''}`}>
      <Link
        className="subnet-link"
        to={`/dia-chi-ip/${subnet.id}`}
        aria-current={active ? 'page' : undefined}
      >
        <span className="row">
          <b className="mono grow">{subnet.cidr}</b>
          {subnet.vlan !== null ? (
            <span className={`badge ${active ? 'brand' : 'muted'} plain`}>
              {t('ipam.vlanBadge', { vlan: subnet.vlan })}
            </span>
          ) : null}
        </span>
        <span className="sub">
          {subnet.name}
          {subnet.siteCode ? ` · ${subnet.siteCode}` : ''}
        </span>
        <UsageBar
          percent={subnet.percent}
          ariaLabel={t('ipam.usageOf', { cidr: subnet.cidr })}
          label={t('ipam.usageLabel', {
            used: subnet.used,
            total: subnet.total,
            free: subnet.free,
          })}
        />
      </Link>
      {canEdit ? (
        <div className="subnet-card-actions">
          <button
            type="button"
            className="btn sm"
            aria-label={t('ipam.editSubnetOf', { cidr: subnet.cidr })}
            onClick={onEdit}
          >
            {t('common.edit')}
          </button>
          <button
            type="button"
            className="btn sm"
            aria-label={t('ipam.hideSubnetOf', { cidr: subnet.cidr })}
            onClick={onHide}
          >
            {t('ipam.hide')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
