import { useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { Field } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { activeOptions, useCatalogLists } from '@/ui/use-catalog-lists';
import { useDebouncedValue } from '@/ui/use-debounced-value';

/** Một dòng `GET /devices` — đủ để chọn và để nói vì sao không chèn được. */
interface StockDevice {
  id: string;
  code: string;
  name: string;
  status: string;
  deviceTypeName: string;
  siteCode: string | null;
  cabinetCode: string | null;
}

/** Số máy mỗi lượt tìm — gõ thêm hoặc lọc để thu hẹp; một hộp gọn không cuộn qua cả kho. */
const STOCK_LIMIT = 20;

/**
 * Phần query của `GET /devices` cho hộp Thiết bị kho. `usable=true`: máy đã thanh lý không bao giờ
 * được chèn (Q-23), lọc ở server để chúng không chiếm chỗ trong `STOCK_LIMIT` dòng.
 */
export function stockQuery(filter: { term: string; siteId: string; cabinetId: string; deviceTypeId: string }): string {
  const params = new URLSearchParams({ limit: String(STOCK_LIMIT), usable: 'true' });
  if (filter.term.trim()) params.set('search', filter.term.trim());
  if (filter.siteId) params.set('siteId', filter.siteId);
  if (filter.cabinetId) params.set('cabinetId', filter.cabinetId);
  if (filter.deviceTypeId) params.set('deviceTypeId', filter.deviceTypeId);
  return params.toString();
}

/**
 * Nội dung hộp "Thiết bị kho" của màn sửa sơ đồ: tìm theo mã/tên/IP, lọc site/tủ/loại, kéo một
 * máy thả thẳng vào bản vẽ, hoặc tick một hoặc nhiều máy rồi Chèn. Máy đã thanh lý không hiện. Máy đã có trên bản vẽ vẫn HIỆN nhưng ô tick
 * tắt, kèm lý do — ẩn nó đi thì người vẽ tưởng kho không có máy đó.
 *
 * Bàn phím: ↓ từ ô tìm sang danh sách, ↑/↓ giữa các dòng, Space tick, Enter chèn.
 */
export function StockDevicePicker({
  present,
  busy,
  onInsert,
  drag,
}: {
  /** Id máy đã có ô trên bản vẽ (đọc từ XML trình vẽ gửi gần nhất + vừa chèn). */
  present: Set<string>;
  busy: boolean;
  onInsert: (ids: string[]) => void;
  /**
   * Kéo một dòng thả thẳng vào trình vẽ (Q-23 06/10). Dòng chỉ kéo được khi ô của máy đã dựng sẵn
   * (`payload` khác `null`): dữ liệu kéo phải gắn NGAY lúc bắt đầu kéo, không chờ mạng được —
   * `prepare` (rê chuột / tiêu điểm vào dòng) đọc trước ô của máy.
   */
  drag?: {
    prepare: (id: string) => void;
    payload: (id: string) => string | null;
    onStart: (id: string) => void;
    onEnd: (id: string, dropEffect: string) => void;
  };
}) {
  const { t } = useTranslation();
  const lists = useCatalogLists();
  const [term, setTerm] = useState('');
  const [siteId, setSiteId] = useState('');
  const [cabinetId, setCabinetId] = useState('');
  const [deviceTypeId, setDeviceTypeId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const settled = useDebouncedValue(term);
  const query = stockQuery({ term: settled, siteId, cabinetId, deviceTypeId });
  const devices = useQuery({
    queryKey: ['diagram-stock', query],
    queryFn: () => apiFetch<{ items: StockDevice[] }>(`/api/v1/devices?${query}`),
  });

  const reasonOf = (device: StockDevice): string | null => (present.has(device.id) ? t('diagrams.stock.already') : null);
  // Lớp chặn thứ hai: đổi ngữ nghĩa `usable` phía server cũng không được làm máy thanh lý hiện lại.
  const items = (devices.data?.items ?? []).filter((d) => d.status !== 'retired');
  const insertable = picked.filter((id) => items.some((d) => d.id === id && !reasonOf(d)));
  // "Chọn tất cả" chỉ lấy máy chèn được: máy đã có trên bản vẽ chèn lần hai là sinh lệch (E-08).
  const choosable = items.filter((d) => !reasonOf(d)).map((d) => d.id);
  const allPicked = choosable.length > 0 && choosable.every((id) => picked.includes(id));

  const toggle = (id: string) => setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  const insert = () => {
    if (insertable.length === 0 || busy) return;
    onInsert(insertable);
  };

  /** ↑/↓ đi giữa các ô tick (kể cả từ ô tìm xuống), Enter chèn. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const boxes = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not([disabled])'));
    const at = boxes.indexOf(event.target as HTMLInputElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const next = event.key === 'ArrowDown' ? (at < 0 ? 0 : at + 1) : at - 1;
      if (next < 0 || next >= boxes.length) return;
      event.preventDefault();
      boxes[next].focus();
    } else if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
      event.preventDefault();
      insert();
    }
  };

  const cabinets = (lists.data?.cabinets ?? []).filter((c) => !siteId || c.siteId === siteId);

  return (
    <div className="stock-picker" onKeyDown={onKeyDown}>
      <Field label={t('diagrams.stock.search')} htmlFor="diagram-stock-search" hint={drag ? t('diagrams.stock.dragHint') : t('diagrams.stock.keyboardHint')}>
        <input
          id="diagram-stock-search"
          className="inp"
          type="search"
          autoComplete="off"
          placeholder={t('diagrams.stock.searchPlaceholder')}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
      </Field>
      <div className="stock-filters">
        <Select
          value={siteId}
          ariaLabel={t('diagrams.stock.site')}
          failed={lists.isError}
          options={[{ value: '', label: t('diagrams.stock.allSites') }, ...activeOptions(lists.data?.sites, siteId, (s) => s.code)]}
          onChange={(value) => {
            setSiteId(value);
            setCabinetId('');
          }}
        />
        <Select
          value={cabinetId}
          ariaLabel={t('diagrams.stock.cabinet')}
          failed={lists.isError}
          options={[
            { value: '', label: t('diagrams.stock.allCabinets') },
            ...activeOptions(cabinets, cabinetId, (c) => `${c.siteCode} · ${c.code}`),
          ]}
          onChange={setCabinetId}
        />
        <Select
          value={deviceTypeId}
          ariaLabel={t('diagrams.stock.type')}
          failed={lists.isError}
          options={[{ value: '', label: t('diagrams.stock.allTypes') }, ...activeOptions(lists.data?.deviceTypes, deviceTypeId, (d) => d.name)]}
          onChange={setDeviceTypeId}
        />
      </div>
      {devices.isError ? (
        <p className="alert error" role="alert">
          {t('diagrams.stock.loadFailed')}
        </p>
      ) : devices.isSuccess && items.length === 0 ? (
        <p className="muted">{t('diagrams.stock.empty')}</p>
      ) : (
        <>
        {devices.isSuccess ? (
          <div className="stock-head">
            <span className="muted" role="status">
              {items.length >= STOCK_LIMIT ? t('diagrams.stock.countCapped', { count: items.length }) : t('diagrams.stock.count', { count: items.length })}
            </span>
            {choosable.length > 0 ? (
              <button
                type="button"
                className="btn sm"
                onClick={() => setPicked(allPicked ? picked.filter((id) => !choosable.includes(id)) : [...new Set([...picked, ...choosable])])}
              >
                {allPicked ? t('diagrams.stock.unpickAll') : t('diagrams.stock.pickAll', { count: choosable.length })}
              </button>
            ) : null}
          </div>
        ) : null}
        <ul className="stock-list" aria-label={t('diagrams.stock.results')} aria-busy={devices.isFetching}>
          {items.map((device) => {
            const reason = reasonOf(device);
            const reasonId = `diagram-stock-why-${device.id}`;
            const payload = !reason && drag ? drag.payload(device.id) : null;
            return (
              <li
                key={device.id}
                draggable={Boolean(payload)}
                data-drag-ready={payload ? '' : undefined}
                title={payload ? t('diagrams.stock.dragRow') : undefined}
                onPointerEnter={() => (!reason ? drag?.prepare(device.id) : undefined)}
                onFocus={() => (!reason ? drag?.prepare(device.id) : undefined)}
                onDragStart={(event) => {
                  if (!payload || !drag) {
                    event.preventDefault();
                    return;
                  }
                  event.dataTransfer.setData('text/plain', payload);
                  event.dataTransfer.effectAllowed = 'copy';
                  drag.onStart(device.id);
                }}
                onDragEnd={(event) => drag?.onEnd(device.id, event.dataTransfer.dropEffect)}
              >
                <label className="stock-row">
                  <input
                    type="checkbox"
                    aria-label={t('diagrams.stock.pickOf', { code: device.code })}
                    aria-describedby={reason ? reasonId : undefined}
                    disabled={Boolean(reason)}
                    checked={!reason && picked.includes(device.id)}
                    onChange={() => toggle(device.id)}
                  />
                  <span>
                    <span className="mono">{device.code}</span>{' '}
                    <small className="muted">
                      {[device.name, device.deviceTypeName, [device.siteCode, device.cabinetCode].filter(Boolean).join(' · ')]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                    {reason ? (
                      <span id={reasonId} className="badge muted stock-why">
                        {reason}
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        </>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn primary" disabled={insertable.length === 0 || busy} onClick={insert}>
          {busy
            ? t('diagrams.stock.inserting')
            : insertable.length > 0
              ? t('diagrams.stock.insertCount', { count: insertable.length })
              : t('diagrams.stock.insert')}
        </button>
      </div>
    </div>
  );
}
