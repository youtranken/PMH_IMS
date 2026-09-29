import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { orDash } from '@/lib/format';
import { foldSearch } from '@/lib/search-fold';
import { Combobox } from '@/ui/combobox';
import { MOBILE_CARD_QUERY, TableWrap } from '@/ui/data-table';
import { useMediaQuery } from '@/ui/use-media-query';
import { Dialog } from '@/ui/dialog';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field } from '@/ui/page-header';
import { RowActions, type RowAction } from '@/ui/row-actions';
import { SuggestInput } from '@/ui/suggest-input';
import { useDepartments } from '@/ui/use-departments';
import { useFormErrors } from '@/ui/use-form-errors';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';
import type { DeviceRow } from '@/lib/device-types';
import { PATHS } from '@/lib/routes';
import { nextPortLabel, sortByPortLabel } from './port-label';

export interface PortRow {
  id: string;
  portLabel: string;
  connectedDeviceId: string | null;
  connectedDeviceCode: string | null;
  connectedDeviceName: string | null;
  connectedLabel: string | null;
  connectedPort: string | null;
  usedBy: string | null;
  /** VLAN của cổng (0029) — text vì "trunk" là giá trị có thật trên uplink. */
  vlan: string | null;
  note: string | null;
}

export interface IncomingPortRow {
  id: string;
  deviceId: string;
  deviceCode: string;
  deviceName: string;
  portLabel: string;
  connectedPort: string | null;
  usedBy: string | null;
  vlan: string | null;
  note: string | null;
}

export interface PortMap {
  ports: PortRow[];
  incoming: IncomingPortRow[];
}

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
 * Port map của một thiết bị (story 2.4, FR-006, AD-14).
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
  const cards = useMediaQuery(MOBILE_CARD_QUERY);

  const queryKey = ['devices', device.id, 'ports'];
  const map = useQuery({
    queryKey,
    queryFn: () => apiFetch<PortMap>(`/api/v1/devices/${device.id}/ports`),
  });

  const remove = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/devices/${device.id}/ports/${input.id}`,
    { method: 'DELETE', csrfToken, refreshMe: false, body: () => undefined },
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

  const actionsFor = (port: PortRow): RowAction[] => [
    { key: 'edit', label: t('ports.edit'), onSelect: () => setEditing({ port }) },
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
        {canEdit ? (
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
              <EmptyState title={t('ports.empty')} hint={t('ports.emptyHint')} />
            ) : (
              <EmptyState title={t('ports.lockedEmpty')} />
            )
          ) : ports.length === 0 ? (
            <EmptyState title={t('ports.filterEmpty', { q: filter.trim() })} />
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
                          <div className="action-cell">
                            <RowActions
                              label={t('common.actionsOf', { subject: port.portLabel })}
                              subject={port.portLabel}
                              items={actionsFor(port)}
                            />
                          </div>
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
        <PortForm
          deviceId={device.id}
          deviceCode={device.code}
          port={editing.port}
          csrfToken={csrfToken}
          onClose={() => setEditing(null)}
          onSaved={(keepOpen) => {
            if (!keepOpen) setEditing(null);
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

type PeerMode = 'device' | 'free';

function PortForm({
  deviceId,
  deviceCode,
  port,
  csrfToken,
  onClose,
  onSaved,
}: {
  deviceId: string;
  deviceCode: string;
  port: PortRow | null;
  csrfToken: string;
  onClose: () => void;
  /** `keepOpen`: người dùng chọn "Ghi rồi thêm cổng khác" — form đã tự chuẩn bị cổng kế tiếp. */
  onSaved: (keepOpen: boolean) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [portLabel, setPortLabel] = useState(port?.portLabel ?? '');
  /* Đầu kia là MỘT trong hai: một máy trong kho, hoặc một mô tả tự do (uplink nhà mạng, ổ cắm
     tường). Hai ô cùng hiện thì không rõ phải điền cái nào hay cả hai. */
  const [mode, setMode] = useState<PeerMode>(
    port?.connectedLabel && !port.connectedDeviceId ? 'free' : 'device',
  );
  const [peer, setPeer] = useState<{ id: string; code: string } | null>(
    port?.connectedDeviceId
      ? { id: port.connectedDeviceId, code: port.connectedDeviceCode ?? '' }
      : null,
  );
  const [query, setQuery] = useState(port?.connectedDeviceCode ?? '');
  const [debounced, setDebounced] = useState(query);
  const [connectedLabel, setConnectedLabel] = useState(port?.connectedLabel ?? '');
  const [connectedPort, setConnectedPort] = useState(port?.connectedPort ?? '');
  const [usedBy, setUsedBy] = useState(port?.usedBy ?? '');
  const [vlan, setVlan] = useState(port?.vlan ?? '');
  const departments = useDepartments();
  const [note, setNote] = useState(port?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const keepOpen = useRef(false);
  const labelRef = useRef<HTMLInputElement>(null);
  const check = useFormErrors({ portLabel: !portLabel.trim() && t('ports.portRequired') });

  // Gõ tới đâu tìm tới đó nhưng chờ 250ms — không bắn một request mỗi phím.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(id);
  }, [query]);

  const candidates = useQuery({
    queryKey: ['devices', 'picker', debounced],
    enabled: mode === 'device' && debounced.trim().length >= 2,
    queryFn: () =>
      apiFetch<{ items: DeviceRow[] }>(
        `/api/v1/devices?limit=10&usable=true&search=${encodeURIComponent(debounced.trim())}`,
      ),
  });

  const save = useApiMutation<Record<string, unknown>, unknown>(
    port
      ? `/api/v1/devices/${deviceId}/ports/${port.id}`
      : `/api/v1/devices/${deviceId}/ports`,
    { method: port ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );

  /** Sau "Ghi rồi thêm cổng khác": giữ VLAN và người dùng (cả dãy cổng thường chung), tăng nhãn. */
  const prepareNext = () => {
    setPortLabel(nextPortLabel(portLabel));
    setPeer(null);
    setQuery('');
    setConnectedLabel('');
    setConnectedPort('');
    setNote('');
    labelRef.current?.focus();
  };

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!save.isPending}
      guardUnsaved
      maxWidth={620}
      /* "{Việc} — {máy nào}": hộp "Sửa — Gi1/0/1" không nói cổng của máy nào. */
      title={t('common.titleOf', {
        action: port ? t('ports.editOf', { port: port.portLabel }) : t('ports.add'),
        subject: deviceCode,
      })}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          {/* Khai cả dãy cổng: tên nút cố ý không chứa chữ "Lưu" — nút chính vẫn là "Lưu". */}
          {port ? null : (
            <button
              type="submit"
              form="port-form"
              className="btn"
              disabled={save.isPending}
              onClick={() => {
                keepOpen.current = true;
              }}
            >
              {t('ports.saveAndNext')}
            </button>
          )}
          <button
            type="submit"
            form="port-form"
            className="btn primary"
            disabled={save.isPending}
            onClick={() => {
              keepOpen.current = false;
            }}
          >
            {save.isPending ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="port-form"
        className="form-grid"
        data-columns={1}
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          const label = portLabel.trim();
          const next = keepOpen.current;
          save.mutate(
            {
              portLabel: label,
              // Mỗi sợi dây chỉ có MỘT nguồn sự thật về đầu kia: chế độ nào thì gửi ô đó.
              connectedDeviceId: mode === 'device' ? (peer?.id ?? '') : '',
              connectedLabel: mode === 'free' ? connectedLabel.trim() : '',
              connectedPort: connectedPort.trim(),
              usedBy: usedBy.trim(),
              vlan: vlan.trim(),
              note: note.trim(),
            },
            {
              onSuccess: () => {
                toast({ message: t('ports.saved', { port: label }) });
                if (next) prepareNext();
                onSaved(next);
              },
              onError: (err) => setError(errorMessage(err)),
            },
          );
        }}
      >
        {/* Lỗi ở ĐẦU form: hộp dài thì lỗi ở cuối nằm ngoài tầm nhìn, người dùng bấm Lưu mãi. */}
        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
        {check.summary}

        <Field label={t('ports.port')} required htmlFor="port-label" error={check.error('portLabel')}>
          <input
            ref={labelRef}
            id="port-label"
            className="inp mono"
            required
            placeholder={t('ports.phPort')}
            value={portLabel}
            onChange={(e) => setPortLabel(e.target.value)}
          />
        </Field>

        <div className="segmented" role="radiogroup" aria-label={t('ports.peerKind')}>
          {(['device', 'free'] as const).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="peer-kind"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              {t(value === 'device' ? 'ports.peerKindDevice' : 'ports.peerKindFree')}
            </label>
          ))}
        </div>

        {mode === 'device' ? (
          <Field label={t('ports.peerDevice')} hint={t('ports.peerDeviceHint')}>
            <Combobox
              placeholder={t('ports.peerSearch')}
              /* Tên trợ năng tường minh: form này có HAI combobox (thiết bị đầu kia và ô "ai
                 dùng" gợi ý theo danh mục Bộ phận). */
              ariaLabel={t('ports.peerDevice')}
              query={query}
              onQuery={(value) => {
                setQuery(value);
                // Gõ lại là bỏ lựa chọn cũ — nếu không, ô hiện tên A mà id vẫn là B.
                setPeer(null);
              }}
              options={candidates.data?.items.filter((item) => item.id !== deviceId) ?? []}
              failed={candidates.isError}
              getKey={(item) => item.id}
              renderOption={(item) => (
                <>
                  <span className="mono">{item.code}</span> <small>{item.name}</small>
                </>
              )}
              onSelect={(item) => {
                setPeer({ id: item.id, code: item.code });
                setQuery(item.code);
              }}
            />
          </Field>
        ) : (
          <Field label={t('ports.freeText')} hint={t('ports.freeTextHint')} htmlFor="port-free">
            <input
              id="port-free"
              className="inp"
              value={connectedLabel}
              onChange={(e) => setConnectedLabel(e.target.value)}
            />
          </Field>
        )}

        <Field label={t('ports.peerPort')} htmlFor="port-peer-port">
          <input
            id="port-peer-port"
            className="inp mono"
            value={connectedPort}
            onChange={(e) => setConnectedPort(e.target.value)}
          />
        </Field>
        <Field label={t('ports.vlan')} hint={t('ports.vlanHint')} htmlFor="port-vlan">
          <input
            id="port-vlan"
            className="inp mono"
            placeholder={t('ports.phVlan')}
            value={vlan}
            onChange={(e) => setVlan(e.target.value)}
          />
        </Field>

        <Field label={t('ports.usedBy')}>
          {/* Cùng danh mục Bộ phận với ô "ai đang dùng" của hồ sơ IP và của sổ NAT — ba chỗ
              trả lời cùng một câu, viết lệch nhau thì tra chéo không ra. */}
          <SuggestInput
            value={usedBy}
            onChange={setUsedBy}
            options={departments.names}
            failed={departments.failed}
            placeholder={t('ports.usedByPlaceholder')}
            ariaLabel={t('ports.usedBy')}
          />
        </Field>
        <Field label={t('ports.note')} htmlFor="port-note">
          <input
            id="port-note"
            className="inp"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}
