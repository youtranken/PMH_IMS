import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { orDash } from '@/lib/format';
import { foldSearch } from '@/lib/search-fold';
import { MOBILE_CARD_QUERY, TableWrap } from '@/ui/data-table';
import { useMediaQuery } from '@/ui/use-media-query';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { RowActions, type RowAction, type RowPrimaryAction } from '@/ui/row-actions';
import { useCatalogLists } from '@/ui/use-catalog-lists';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';
import type { DeviceRow } from '@/lib/device-types';
import { PATHS } from '@/lib/routes';
import { sortByPortLabel } from '@/lib/port-label';
import type { PortMap, PortRow } from '@/lib/port-types';
import { CableSwatch } from '@/ui/cable-swatch';
import { BulkLinkDialog } from '@/ui/bulk-link-dialog';
import { PortFormDialog } from '@/ui/port-form-dialog';

/** Có hơn ngần này cổng thì hiện ô lọc: switch 48 cổng mà phải cuộn dò bằng mắt là chậm. */
const FILTER_FROM = 8;

/**
 * Ô trống (`—`) trên điện thoại: thẻ xếp chồng ẩn hẳn dòng đó (`td[data-empty]`), để mỗi cổng
 * còn 2–3 dòng thay vì 7 dòng toàn gạch ngang.
 */
function emptyAttr(value: string | null | undefined): { 'data-empty'?: true } {
  return value ? {} : { 'data-empty': true };
}

/**
 * Port map của một thiết bị (FR-006, AD-14).
 *
 * Bảng dưới ("Đang cắm vào thiết bị này") KHÔNG phải dữ liệu riêng — nó là CHIỀU NGƯỢC
 * của những dòng do thiết bị khác giữ, dựng bằng query. Không sửa được ở đây là có chủ ý:
 * sửa ở đúng nơi giữ bản ghi thì hai đầu không bao giờ mâu thuẫn nhau.
 */
export function PortMapPanel({
  device,
  csrfToken,
  canEdit,
}: {
  device: DeviceRow;
  csrfToken: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ port: PortRow | null } | null>(null);
  const [filter, setFilter] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const cards = useMediaQuery(MOBILE_CARD_QUERY);
  const lists = useCatalogLists();
  const cableOf = (id: string | null | undefined) => (id ? (lists.data?.cableTypes ?? []).find((c) => c.id === id) : undefined);
  /** Loại dây: vạch màu + tên, "(ngừng dùng)" khi loại đã ngừng (dây cũ giữ màu — Q-14). */
  const cableCell = (id: string | null | undefined) => {
    const cable = cableOf(id);
    if (!cable) return orDash(null);
    return (
      <span>
        <CableSwatch slot={cable.colorSlot} /> {cable.name}
        {cable.active ? null : <span className="muted"> {t('formErrors.retiredOption')}</span>}
      </span>
    );
  };

  const queryKey = ['devices', device.id, 'ports'];
  const map = useQuery({
    queryKey,
    queryFn: () => apiFetch<PortMap>(`/api/v1/devices/${device.id}/ports`),
  });

  const remove = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/devices/${device.id}/ports/${input.id}`,
    { method: 'DELETE', csrfToken, refreshMe: false, body: () => undefined },
  );

  /* Gỡ dây mà giữ dòng cổng (T-02): endpoint `unlink` của devices bỏ đầu kia, giữ VLAN / người
     dùng / ghi chú — Xóa dòng thì mất luôn những thứ đó. */
  const unlink = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/devices/${device.id}/ports/${input.id}/unlink`,
    { method: 'POST', csrfToken, refreshMe: false, body: () => undefined },
  );

  /* Cả cây `['devices', id]`, không chỉ bảng cổng: lượt thêm/sửa/xóa cổng ghi vào lịch sử máy,
     mà trang chi tiết nạp lịch sử ngay khi mở hồ sơ — chỉ làm cũ bảng cổng thì tab Lịch sử
     hiện bản chụp trước lượt sửa. */
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['devices', device.id] });
  // Thứ tự mặt trước switch: Gi1/0/2 trước Gi1/0/10.
  const allPorts = sortByPortLabel(map.data?.ports ?? []);
  const folded = foldSearch(filter.trim());
  const ports = folded
    ? allPorts.filter((port) =>
        foldSearch(
          [
            port.portLabel,
            port.connectedDeviceCode,
            port.connectedDeviceName,
            port.connectedLabel,
            port.usedBy,
            port.vlan,
            port.note,
          ]
            .filter(Boolean)
            .join(' '),
        ).includes(folded),
      )
    : allPorts;
  const incoming = sortByPortLabel(map.data?.incoming ?? []);

  const primaryFor = (port: PortRow): RowPrimaryAction => ({
    label: t('ports.edit'),
    ariaLabel: t('ports.editOf', { port: port.portLabel }),
    onClick: () => setEditing({ port }),
  });

  const actionsFor = (port: PortRow): RowAction[] => [
    ...(port.connectedDeviceId || port.connectedLabel
      ? [
          {
            key: 'unlink',
            label: t('ports.unlink'),
            warn: true,
            disabled: unlink.isPending,
            onSelect: () => {
              void (async () => {
                const ok = await askConfirm({
                  title: t('common.titleOf', { action: t('ports.unlinkOf', { port: port.portLabel }), subject: device.code }),
                  message: t('ports.confirmUnlink', { port: port.portLabel }),
                  confirmLabel: t('ports.unlinkConfirm'),
                });
                if (!ok) return;
                unlink.mutate(
                  { id: port.id },
                  {
                    onSuccess: () => {
                      toast({ message: t('ports.unlinked', { port: port.portLabel }) });
                      void refresh();
                    },
                    onError: (error) => toast({ message: errorMessage(error), tone: 'error' }),
                  },
                );
              })();
            },
          } satisfies RowAction,
        ]
      : []),
    {
      key: 'remove',
      label: t('ports.remove'),
      danger: true,
      disabled: remove.isPending,
      onSelect: () => {
        void (async () => {
          const ok = await askConfirm({
            title: t('common.titleOf', {
              action: t('ports.removeOf', { port: port.portLabel }),
              subject: device.code,
            }),
            message: t('ports.confirmRemove', { port: port.portLabel }),
            danger: true,
            confirmLabel: t('ports.remove'),
          });
          if (!ok) return;
          remove.mutate(
            { id: port.id },
            {
              onSuccess: () => {
                toast({ message: t('ports.removed', { port: port.portLabel }) });
                void refresh();
              },
              onError: (error) => toast({ message: errorMessage(error), tone: 'error' }),
            },
          );
        })();
      },
    },
  ];

  return (
    <div className="port-map">
      {/* Thanh công cụ của tab: tiêu đề khu + số đếm bên trái, nút thêm bên phải, CÙNG hàng
          ngay dưới thanh tab — tab nào cũng một chỗ cho nút thêm. */}
      <div className="section-bar">
        <h2 className="form-section-title">{t('ports.own')}</h2>
        {map.data ? <span className="section-count">{allPorts.length}</span> : null}
        {/* Chưa khai cổng nào thì nút Thêm nằm trong khối trống ngay bên dưới — hai nút cùng
            tên cách nhau một dòng là thừa. */}
        {canEdit ? (
          <button type="button" className="btn" onClick={() => setBulkOpen(true)}>
            {t('ports.bulkButton')}
          </button>
        ) : null}
        {canEdit && !(map.data && allPorts.length === 0) ? (
          <button type="button" className="btn primary" onClick={() => setEditing({ port: null })}>
            {t('ports.add')}
          </button>
        ) : null}
      </div>

      {map.isLoading ? (
        <Loading />
      ) : map.isError ? (
        <LoadError error={map.error} onRetry={() => void map.refetch()} />
      ) : (
        <>
          {allPorts.length > FILTER_FROM ? (
            <input
              type="search"
              className="inp search port-filter"
              value={filter}
              placeholder={t('ports.filter')}
              aria-label={t('ports.filter')}
              onChange={(event) => setFilter(event.target.value)}
            />
          ) : null}
          {allPorts.length === 0 ? (
            /* Hồ sơ đã khoá (máy thanh lý) thì không mời "khai cổng" — không có nút nào để khai. */
            canEdit ? (
              <EmptyState
                title={t('ports.empty')}
                hint={t('ports.emptyHint')}
                action={
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => setEditing({ port: null })}
                  >
                    {t('ports.add')}
                  </button>
                }
              />
            ) : (
              <EmptyState title={t('ports.lockedEmpty')} />
            )
          ) : ports.length === 0 ? (
            <EmptyState
              title={t('ports.filterEmpty', { q: filter.trim() })}
              action={
                <button type="button" className="btn" onClick={() => setFilter('')}>
                  {t('common.clearFilters')}
                </button>
              }
            />
          ) : cards ? (
            /* Điện thoại: mỗi cổng HAI dòng — "cổng → đầu kia : cổng đầu kia", rồi "VLAN · người
               dùng" — ⋯ ở góc. Người đứng trước tủ dò một cổng giữa 48 cái, thẻ 7 dòng là phải
               cuộn mấy màn. Ghi chú (nếu có) là dòng nhỏ thứ ba. */
            <ul className="list-cards" aria-label={t('ports.own')}>
              {ports.map((port) => {
                const peer = port.connectedDeviceId ? (
                  <Link className="mono" to={PATHS.device(port.connectedDeviceId)}>
                    {port.connectedDeviceCode}
                  </Link>
                ) : (
                  port.connectedLabel
                );
                const second = [
                  cableOf(port.cableTypeId)?.name ?? null,
                  port.vlan ? `${t('ports.vlan')} ${port.vlan}` : null,
                  port.usedBy,
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <li key={port.id} className="list-card">
                    <div className="list-card-top">
                      <span className="list-card-title">
                        <span className="mono">{port.portLabel}</span>
                        {peer ? (
                          <>
                            {' → '}
                            {peer}
                            {port.connectedPort ? (
                              <span className="mono"> : {port.connectedPort}</span>
                            ) : null}
                          </>
                        ) : null}
                      </span>
                      {canEdit ? (
                        <span className="list-card-end">
                          <RowActions
                            primary={primaryFor(port)}
                            label={t('common.actionsOf', { subject: port.portLabel })}
                            subject={port.portLabel}
                            items={actionsFor(port)}
                          />
                        </span>
                      ) : null}
                    </div>
                    {second ? <div className="list-card-sub">{second}</div> : null}
                    {port.note ? (
                      <div className="list-card-bottom">
                        <span className="list-card-meta">{port.note}</span>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            /* Bảng rộng hơn cột chính ở router (7 cột): cuộn ngang trong khung, cột Cổng dính
               trái và cột thao tác dính phải — cuộn tới VLAN/Ghi chú vẫn biết đang ở cổng nào, và
               mở ⋯ không làm trôi mất cột định danh. */
            <TableWrap>
              <table className="table table-stack wide">
                <thead>
                  <tr>
                    <th className="col-sticky-start">{t('ports.port')}</th>
                    <th>{t('ports.connectedTo')}</th>
                    <th>{t('ports.peerPort')}</th>
                    <th>{t('ports.cableType')}</th>
                    <th>{t('ports.usedBy')}</th>
                    <th>{t('ports.vlan')}</th>
                    <th>{t('ports.note')}</th>
                    {canEdit ? (
                      <th className="col-center col-sticky-end">{t('common.actions')}</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {ports.map((port) => (
                    <tr key={port.id}>
                      <td data-label={t('ports.port')} className="mono col-sticky-start">
                        {port.portLabel}
                      </td>
                      <td
                        data-label={t('ports.connectedTo')}
                        {...emptyAttr(port.connectedDeviceId ?? port.connectedLabel)}
                      >
                        {port.connectedDeviceId ? (
                          <Link className="mono" to={PATHS.device(port.connectedDeviceId)}>
                            {port.connectedDeviceCode}
                          </Link>
                        ) : (
                          orDash(port.connectedLabel)
                        )}
                        {port.connectedDeviceName ? (
                          <span className="cell-sub">{port.connectedDeviceName}</span>
                        ) : null}
                      </td>
                      <td
                        data-label={t('ports.peerPort')}
                        className="mono"
                        {...emptyAttr(port.connectedPort)}
                      >
                        {orDash(port.connectedPort)}
                      </td>
                      <td data-label={t('ports.cableType')} {...emptyAttr(cableOf(port.cableTypeId)?.name)}>
                        {cableCell(port.cableTypeId)}
                      </td>
                      <td data-label={t('ports.usedBy')} {...emptyAttr(port.usedBy)}>
                        {orDash(port.usedBy)}
                      </td>
                      <td data-label={t('ports.vlan')} className="mono" {...emptyAttr(port.vlan)}>
                        {orDash(port.vlan)}
                      </td>
                      <td data-label={t('ports.note')} {...emptyAttr(port.note)}>
                        {orDash(port.note)}
                      </td>
                      {canEdit ? (
                        <td data-label={t('common.actions')} className="col-sticky-end">
                          <RowActions
                            primary={primaryFor(port)}
                            label={t('common.actionsOf', { subject: port.portLabel })}
                            subject={port.portLabel}
                            items={actionsFor(port)}
                          />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}

          <h2 className="form-section-title">{t('ports.incoming')}</h2>
          {incoming.length === 0 ? (
            /* Rỗng thì MỘT dòng — tiêu đề + đoạn giải thích + câu rỗng là ba khối cho một chữ "không". */
            <p className="muted">{t('ports.incomingEmpty')}</p>
          ) : (
            <>
              <p className="muted small">{t('ports.incomingHint')}</p>
              <div className="table-wrap">
                <table className="table table-stack wide">
                  <thead>
                    <tr>
                      <th>{t('ports.fromDevice')}</th>
                      <th>{t('ports.port')}</th>
                      <th>{t('ports.peerPort')}</th>
                      <th>{t('ports.vlan')}</th>
                      <th>{t('ports.usedBy')}</th>
                      <th>{t('ports.note')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incoming.map((row) => (
                      <tr key={row.id}>
                        <td data-label={t('ports.fromDevice')}>
                          <Link className="mono" to={PATHS.device(row.deviceId)}>
                            {row.deviceCode}
                          </Link>
                          <span className="cell-sub">{row.deviceName}</span>
                        </td>
                        <td data-label={t('ports.port')} className="mono">
                          {row.portLabel}
                        </td>
                        <td
                          data-label={t('ports.peerPort')}
                          className="mono"
                          {...emptyAttr(row.connectedPort)}
                        >
                          {orDash(row.connectedPort)}
                        </td>
                        <td data-label={t('ports.vlan')} className="mono" {...emptyAttr(row.vlan)}>
                          {orDash(row.vlan)}
                        </td>
                        <td data-label={t('ports.usedBy')} {...emptyAttr(row.usedBy)}>
                          {orDash(row.usedBy)}
                        </td>
                        <td data-label={t('ports.note')} {...emptyAttr(row.note)}>
                          {orDash(row.note)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {editing ? (
        <PortFormDialog
          device={{ id: device.id, code: device.code }}
          port={editing.port}
          csrfToken={csrfToken}
          onClose={() => setEditing(null)}
          onSaved={(keepOpen) => {
            if (!keepOpen) setEditing(null);
            void refresh();
          }}
        />
      ) : null}
      {bulkOpen ? (
        <BulkLinkDialog
          device={{ id: device.id, code: device.code }}
          csrfToken={csrfToken}
          onClose={() => setBulkOpen(false)}
          onDone={(links) => {
            setBulkOpen(false);
            toast({ message: t('ports.bulkDone', { count: links.length, code: device.code }) });
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}
