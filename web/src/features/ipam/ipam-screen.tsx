import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { foldSearch } from '@/lib/search-fold';
import { Select } from '@/ui/select';
import { useIsNarrow } from '@/ui/use-narrow';
import { apiFetch } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import type { Me } from '@/lib/me';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { RowActions, type RowAction } from '@/ui/row-actions';
import { UsageBar } from '@/ui/usage-bar';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';
import { errorMessage } from '@/lib/api';
import { HideDialog, SubnetForm } from './subnet-form';
import { SubnetPane } from './subnet-detail';
import { IpLookup } from './ip-lookup';
import type { SubnetRow } from './ipam-types';
import { PATHS } from '@/lib/routes';
import { useIpamSettings } from './ipam-settings';
import { groupSubnets, type SubnetGroupKey } from './subnet-groups';

/** Từ bao nhiêu dải thì cột trái cần ô lọc — ít hơn thế thì liếc là thấy. */
const RAIL_FILTER_FROM = 6;

/**
 * Địa chỉ IP (FR-018/FR-020) — MỘT trang hai cột, đúng mockup `body-Ipam.html`:
 * dải mạng ở cột trái, IP của dải đang chọn ở cột phải.
 *
 * Không tách thành hai trang (bảng dải / bảng IP): khi đó đường đi giữa chúng chỉ là mã CIDR
 * gạch chân trong ô đầu bảng, không ai nhận ra đó là đường vào, và cả màn trông như "khai
 * được dải mà không khai được IP nào". Hai cột thì chỗ trống và nút "Cấp IP này" nằm ngay
 * cạnh danh sách dải, không phải bấm mò mới thấy.
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

  /*
   * `includeVoided=true` — CHỈ màn này.
   *
   * Nếu vô hiệu hóa làm dải biến mất khỏi danh sách, người dùng đọc đúng cái đó là "đã xóa
   * hẳn" — họ không sai, vì không còn chỗ nào trên giao diện nói nó tồn tại.
   * Nhưng dải ấy vẫn giữ mấy chục hồ sơ IP tĩnh, và mấy cái máy ngoài kia không tự nhả địa
   * chỉ ra chỉ vì cuốn sổ đã cất dải đi. Giữ nó lại, gạch ngang, rồi mới cho xóa.
   *
   * Mọi chỗ ĐỌC dải khác (bảng điều khiển, form NAT) vẫn gọi mặc định = chỉ dải đang dùng.
   */
  const subnets = useQuery({
    queryKey: ['ipam', 'subnets', 'withVoided'],
    queryFn: () => apiFetch<SubnetRow[]>('/api/v1/ipam/subnets?includeVoided=true'),
  });
  const fullPercent = useIpamSettings().subnetFullPercent;

  // Chỉ dải và IP của dải: sổ NAT không đổi khi khai/sửa dải, tải lại nó là tốn công vô ích.
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ipam', 'subnets'] });

  /**
   * Bật lại một dải đã vô hiệu hóa.
   *
   * Không hỏi lý do — bật lại là khôi phục, nó không lấy đi thứ gì. Vẫn hỏi lại một câu vì nó
   * kéo theo cả đám hồ sơ IP đã tắt cùng dải, và người bấm nên biết con số đó trước.
   */
  const restoreSubnet = async (subnet: SubnetRow) => {
    const ok = await askConfirm({
      title: t('ipam.restoreTitle', { cidr: subnet.cidr }),
      message: t('ipam.restoreConfirm', { cidr: subnet.cidr, count: subnet.addressCount }),
      confirmLabel: t('ipam.restore'),
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/v1/ipam/subnets/${subnet.id}/restore`, {
        method: 'PATCH',
        csrfToken: me.csrfToken,
      });
      toast({ message: t('ipam.subnetRestored') });
      void refresh();
    } catch (error) {
      toast({ message: errorMessage(error), tone: 'error' });
    }
  };

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
  /**
   * Dải đã vô hiệu hóa XUỐNG CUỐI cột trái, giữ nguyên thứ tự CIDR trong từng nhóm.
   *
   * Chúng phải ở lại (xem `includeVoided` ở trên), nhưng xen kẽ theo thứ tự địa
   * chỉ thì sau một năm cột trái là một danh sách lẫn lộn cái còn dùng với cái đã bỏ, và người
   * ta phải đọc huy hiệu từng thẻ mới biết cái nào là cái nào. `sort` trên bản SAO — mảng của
   * TanStack Query là dữ liệu cache dùng chung, sắp tại chỗ là sửa cache của mọi nơi khác.
   */
  const rows = useMemo(
    () =>
      [...(subnets.data ?? [])].sort(
        (a, b) => Number(a.voidedAt !== null) - Number(b.voidedAt !== null),
      ),
    [subnets.data],
  );
  // Không có `:id` thì mở sẵn dải đầu tiên — mở ra một cột phải trống rỗng rồi bắt người dùng
  // tự bấm một cái nữa là bắt vô cớ. KHÔNG điều hướng: đổi URL sau lưng người dùng làm nút
  // Back của trình duyệt hết đoán được.
  const selected = rows.find((row) => row.id === id) ?? rows[0] ?? null;
  const navigate = useNavigate();
  const narrow = useIsNarrow();
  const [railFilter, setRailFilter] = useState('');
  const shownRows = useMemo(() => {
    const needle = foldSearch(railFilter.trim());
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.cidr, row.name, row.siteCode, row.vlan === null ? null : String(row.vlan), row.gateway]
        .some((field) => field && foldSearch(field).includes(needle)),
    );
  }, [rows, railFilter]);

  /*
   * Thẻ đang mở phải NẰM TRONG tầm nhìn của cột trái: cột cuộn riêng, và mở thẳng link của dải
   * thứ sáu là thẻ đang chọn nằm dưới mép mà không có gì báo. `nearest` không giật cột khi
   * thẻ đã thấy sẵn.
   */
  const groupLabel = (key: SubnetGroupKey): string =>
    key === 'voided'
      ? t('ipam.disabledBadge')
      : key === 'nosite'
        ? t('ipam.noSite')
        : key.slice('site:'.length);

  const railRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    railRef.current
      ?.querySelector<HTMLElement>('.subnet-card.is-active')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [selected?.id, narrow]);
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
        <LoadError error={subnets.error} onRetry={() => void subnets.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('ipam.empty')} hint={t('ipam.emptyHint')} />
      ) : (
        <>
        <IpLookup subnets={rows} />
        <div className="ipam-split">
          {/*
            Điện thoại: MỘT ô chọn dải dính đầu trang thay cho dãy thẻ cuộn ngang — dãy thẻ
            260px không cho biết có bao nhiêu dải, đang ở dải nào, và phải vuốt mới tìm được.
            Thẻ của dải đang chọn vẫn hiện ngay dưới (gateway, mức dùng, menu ⋯).
          */}
          {narrow && selected ? (
            <div className="subnet-picker">
              <Select
                value={selected.id}
                ariaLabel={t('ipam.pickSubnet')}
                options={groupSubnets(rows).flatMap((group) =>
                  group.rows.map((row) => ({
                    value: row.id,
                    label: t('ipam.subnetOption', {
                      cidr: row.cidr,
                      vlan: row.vlan === null ? '' : ` · ${t('ipam.vlanBadge', { vlan: row.vlan })}`,
                      free: row.free,
                    }),
                    group: group.key === 'all' ? undefined : groupLabel(group.key),
                  })),
                )}
                onChange={(value) => navigate(PATHS.subnet(value))}
              />
              <SubnetCard
                subnet={selected}
                active
                canEdit={canEdit}
                fullPercent={fullPercent}
                onEdit={() => setEditing({ subnet: selected })}
                onHide={() => setHiding(selected)}
                onRestore={() => void restoreSubnet(selected)}
                onDelete={() => void removeSubnet(selected)}
              />
            </div>
          ) : (
          <nav className="subnet-rail" aria-label={t('ipam.railLabel')} ref={railRef}>
            <h2 className="form-section-title">{t('ipam.railTitle')}</h2>
            {/* Ô lọc chỉ mọc ra khi dải đủ nhiều để phải tìm — bốn năm thẻ thì liếc là thấy. */}
            {rows.length > RAIL_FILTER_FROM ? (
              <input
                className="inp"
                type="search"
                aria-label={t('ipam.railFilter')}
                placeholder={t('ipam.railFilter')}
                value={railFilter}
                onChange={(e) => setRailFilter(e.target.value)}
              />
            ) : null}
            {shownRows.length === 0 ? (
              <p className="muted">{t('ipam.railFilterEmpty')}</p>
            ) : null}
            {/* Chia theo site khi có hơn một nhóm: ba chi nhánh ba chục dải thì cột một dải
                dài lẫn lộn là phải đọc từng thẻ mới biết thuộc đâu. */}
            {groupSubnets(shownRows).map((group) => (
              <Fragment key={group.key}>
                {group.key === 'all' ? null : (
                  <h3 className="rail-group">{groupLabel(group.key)}</h3>
                )}
                {group.rows.map((subnet) => (
                  <SubnetCard
                    key={subnet.id}
                    subnet={subnet}
                    active={subnet.id === selected?.id}
                    canEdit={canEdit}
                    fullPercent={fullPercent}
                    onEdit={() => setEditing({ subnet })}
                    onHide={() => setHiding(subnet)}
                    onRestore={() => void restoreSubnet(subnet)}
                    onDelete={() => void removeSubnet(subnet)}
                  />
                ))}
              </Fragment>
            ))}
          </nav>
          )}

          <div className="subnet-pane">
            {selected ? <SubnetPane subnet={selected} me={me} /> : null}
          </div>
        </div>
        </>
      )}

      {editing ? (
        <SubnetForm
          subnet={editing.subnet}
          existing={rows}
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
 * bàn phím Tab tới được — ba thứ mất sạch nếu dùng div. Nút thao tác nằm NGOÀI link (không
 * lồng nút trong link) và chỉ hiện khi có quyền.
 */
export function SubnetCard({
  subnet,
  active,
  canEdit,
  fullPercent,
  onEdit,
  onHide,
  onRestore,
  onDelete,
}: {
  subnet: SubnetRow;
  active: boolean;
  canEdit: boolean;
  fullPercent: number;
  onEdit: () => void;
  onHide: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const disabled = subnet.voidedAt !== null;
  /**
   * Xóa HẲN chỉ mở ra khi dải chưa từng có hồ sơ IP nào.
   *
   * Không phải một luật thêm cho vui: `ip_history` là bảng CHỈ-THÊM (AD-13, trigger chặn ở
   * tầng DB), và mấy dòng đó đang giữ câu "IP này từng của máy nào" mà AC 5.2 bắt giữ vĩnh
   * viễn. Dải đã từng dùng thì trạng thái cuối của nó là "đã vô hiệu hóa", không phải "biến
   * mất" — và thẻ nói thẳng ra điều đó thay vì lặng lẽ giấu nút Xóa đi.
   */
  const canDelete = subnet.addressCount === 0;

  const actions: RowAction[] = disabled
    ? [
        { key: 'restore', label: t('ipam.restore'), onSelect: onRestore, ok: true },
        ...(canDelete
          ? [
              {
                key: 'delete',
                label: t('common.delete'),
                onSelect: onDelete,
                danger: true,
              },
            ]
          : []),
      ]
    : [
        { key: 'edit', label: t('common.edit'), onSelect: onEdit },
        /*
         * HAI việc khác nhau, và màn hình tự biết bày cái nào — không bắt người dùng đoán.
         *
         * Dải CHƯA TỪNG có hồ sơ IP → **Xóa** hẳn ngay. Khai nhầm một dải ba giây trước rồi
         * phải sống chung với nó mãi là phiền vô lý; nó chưa mang thông tin gì cả.
         *
         * Dải ĐÃ TỪNG dùng → **Vô hiệu hóa** kèm lý do, và nó Ở LẠI danh sách chứ không
         * biến mất.
         */
        canDelete
          ? { key: 'delete', label: t('common.delete'), onSelect: onDelete, danger: true }
          : { key: 'hide', label: t('ipam.hide'), onSelect: onHide, warn: true },
      ];

  return (
    <div
      className={`subnet-card${active ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}${
        canEdit ? ' has-actions' : ''
      }`}
    >
      <Link
        className="subnet-link"
        to={PATHS.subnet(subnet.id)}
        aria-current={active ? 'page' : undefined}
      >
        <span className="row">
          <b className="mono grow">{subnet.cidr}</b>
          {/* Badge trạng thái ĐI TRƯỚC badge VLAN: "dải này còn dùng không" là câu phải trả
              lời trước "dải này VLAN mấy". */}
          {disabled ? (
            <span className="badge danger plain">{t('ipam.disabledBadge')}</span>
          ) : null}
          {subnet.vlan !== null ? (
            <span className={`badge ${active && !disabled ? 'brand' : 'muted'} plain`}>
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
          <span className="sub subnet-gw">
            {t('ipam.gateway')}: <span className="mono">{subnet.gateway}</span>
          </span>
        ) : null}
        {/* Ngưỡng tô màu = ngưỡng "sắp đầy" của bảng điều khiển (vàng), đỏ từ 90% như mọi
            thanh đo khác — không để hai màn nói hai câu về cùng một dải. */}
        <UsageBar
          percent={subnet.percent}
          ariaLabel={t('ipam.usageOf', { cidr: subnet.cidr })}
          warnAt={fullPercent}
          dangerAt={Math.max(fullPercent, 90)}
        />
        {/* "Còn bao nhiêu chỗ" là câu hỏi thật khi cắm máy — nó đứng dòng chính, con số
            đã dùng lùi xuống dòng phụ; ba con số liền nhau không đơn vị thì không ai đọc ra. */}
        <span className="subnet-usage">
          <b>{t('ipam.usageFree', { free: subnet.free })}</b>
          <span className="sub">
            {t('ipam.usageUsed', { used: subnet.used, total: subnet.total })}
          </span>
        </span>
        {/* Vì sao dải này đang tắt, từ bao giờ, và ai tắt — câu đầu tiên người mở màn sẽ hỏi
            khi thấy một dòng gạch ngang. Nói ngay trên thẻ, cùng câu với trang chi tiết. */}
        {disabled ? (
          <span className="sub subnet-void-note">
            {t('ipam.voidedBy', {
              date: formatDate(subnet.voidedAt),
              by: subnet.voidedBy ?? '—',
              reason: subnet.voidReason ?? '—',
            })}
          </span>
        ) : null}
        {disabled && !canDelete ? (
          <span className="sub subnet-void-note">
            {t('ipam.keptForHistory', { count: subnet.addressCount })}
          </span>
        ) : null}
      </Link>
      {canEdit ? (
        <div className="subnet-card-actions">
          <RowActions
            label={t('common.actionsOf', { subject: subnet.cidr })}
            items={actions}
          />
        </div>
      ) : null}
    </div>
  );
}
