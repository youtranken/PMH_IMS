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
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';
import { errorMessage } from '@/lib/api';
import { HideDialog, SubnetForm } from './subnet-form';
import { SubnetPane } from './subnet-detail';
import type { SubnetRow } from './ipam-types';
import { PATHS } from '@/lib/routes';

/**
 * Địa chỉ IP (story 5.1, FR-018/FR-020) — MỘT trang hai cột, đúng mockup `body-Ipam.html`:
 * dải mạng ở cột trái, IP của dải đang chọn ở cột phải.
 *
 * Bản dựng đầu tách thành hai trang (`/ip-addresses` là bảng dải, `/ip-addresses/:id` là bảng IP),
 * và đường đi giữa chúng là mã CIDR gạch chân trong ô đầu bảng. Không ai nhận ra đó là đường
 * vào, nên cả màn trông như "khai được dải mà không khai được IP nào". Hai cột thì chỗ trống
 * và nút "Cấp IP này" nằm ngay cạnh danh sách dải, không phải bấm mò mới thấy.
 *
 * Cả hai đường dẫn đều vào đây: `/ip-addresses` chọn sẵn dải đầu tiên, `/ip-addresses/:id` chọn
 * đúng dải đó — link cũ vẫn mở được, và mỗi dải vẫn có một địa chỉ riêng để gửi cho nhau.
 */
export function IpamScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
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

  /*
   * Xóa HẲN — không có hộp riêng, chỉ một câu hỏi lại. Khác vô hiệu hóa ở chỗ không cần lý
   * do: dải chưa từng dùng thì chẳng có gì để giải thích, và bắt gõ lý do cho một thứ vừa
   * khai nhầm ba giây trước chỉ là thủ tục.
   *
   * Vẫn phải hỏi lại vì nó không hoàn tác được. API là hàng rào thật: nó tự từ chối nếu dải
   * hóa ra có hồ sơ IP (danh sách trên màn hình có thể đã cũ vài giây).
   */
  const removeSubnet = async (subnet: SubnetRow) => {
    const ok = await askConfirm({
      title: t('ipam.deleteSubnetTitle', { cidr: subnet.cidr }),
      message: t('ipam.deleteSubnetConfirm', { cidr: subnet.cidr }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/v1/ipam/subnets/${subnet.id}`, {
        method: 'DELETE',
        csrfToken: me.csrfToken,
      });
      toast({ message: t('ipam.subnetDeleted') });
      void refresh();
    } catch (error) {
      toast({ message: errorMessage(error), tone: 'error' });
    }
  };
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
                onDelete={() => void removeSubnet(subnet)}
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
  onDelete,
}: {
  subnet: SubnetRow;
  active: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onHide: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={`subnet-card${active ? ' is-active' : ''}`}>
      <Link
        className="subnet-link"
        to={PATHS.subnet(subnet.id)}
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
        {/* Gateway đứng ngay trên thanh mức dùng: đây là con số người ta mở màn này để tra,
            không phải thứ phải bấm vào Sửa mới thấy. */}
        {subnet.gateway ? (
          <span className="sub">
            {t('ipam.gateway')}: <span className="mono">{subnet.gateway}</span>
          </span>
        ) : null}
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
          {/*
            HAI việc khác nhau, và màn hình tự biết bày cái nào — không bắt người dùng đoán:

            Dải CHƯA TỪNG có hồ sơ IP nào → **Xóa** hẳn. Khai nhầm một dải rồi phải sống chung
            với nó mãi là phiền vô lý; nó chưa mang thông tin gì cả, cần thì khai lại.

            Dải ĐÃ TỪNG dùng → **Vô hiệu hóa** kèm lý do. Xóa hẳn là mất luôn câu trả lời "IP
            này từng của máy nào" mà AC 5.2 bắt giữ vĩnh viễn — kể cả khi mọi IP đã thu hồi và
            thanh mức dùng đang chỉ 0%.
          */}
          {subnet.addressCount === 0 ? (
            <button
              type="button"
              className="btn sm danger"
              aria-label={t('ipam.deleteSubnetOf', { cidr: subnet.cidr })}
              onClick={onDelete}
            >
              {t('common.delete')}
            </button>
          ) : (
            <button
              type="button"
              className="btn sm"
              aria-label={t('ipam.hideSubnetOf', { cidr: subnet.cidr })}
              onClick={onHide}
            >
              {t('ipam.hide')}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
