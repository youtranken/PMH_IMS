import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { DeviceCombobox } from '@/ui/device-combobox';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { LocationText } from '@/ui/location-text';
import { Field, PageHeader } from '@/ui/page-header';
import { Tabs } from '@/ui/tabs';
import { useToast } from '@/ui/toast';
import { useUnsavedGuard } from '@/ui/use-unsaved-guard';
import {
  DRAWIO_CONFIG,
  deviceCellJson,
  deviceCellSize,
  deviceIdFromLink,
  driftReasons,
  drawioUrl,
  growBounds,
  insertPatch,
  isCompressed,
  lastChildId,
  layerIdOf,
  nextInsertPosition,
  pageIds,
  parseDeviceRefs,
  withViewerMarks,
  type Bounds,
  type DeviceForDiagram,
  type DrawioMessage,
  type DriftReason,
} from './drawio-bridge';
import { useDrawioFrame } from './use-drawio-frame';

interface DiagramView {
  name: string;
  xml: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

interface DeviceDetail {
  id: string;
  code: string;
  name: string;
  status: string;
  deviceTypeName: string;
  siteCode: string | null;
  cabinetCode: string | null;
}

/** Tên bản vẽ mặc định; `?ten=` mở bản khác (bài E2E dùng tên có chữ E2E, không đè bản thật). */
const DEFAULT_NAME = 'chinh';
const NAME_RE = /^[A-Za-z0-9_-]{1,60}$/;

const STATUS_KEY: Record<string, string> = {
  in_use: 'devices.statusInUse',
  spare: 'devices.statusSpare',
  broken: 'devices.statusBroken',
  retired: 'devices.statusRetired',
};

const DRIFT_KEY: Record<DriftReason, string> = {
  missing: 'diagramSpike.drift.missing',
  retired: 'diagramSpike.drift.retired',
  ip_changed: 'diagramSpike.drift.ip_changed',
  code_changed: 'diagramSpike.drift.code_changed',
};

/** Khung không báo `load` sau chừng này thì nhiều khả năng service drawio chưa chạy. */
const FRAME_STALL_MS = 15_000;

const diagramKey = (name: string) => ['diagram-spike', name] as const;

/* Khung sandbox KHÔNG có allow-same-origin — xem `web/drawio-headers.conf`. */
const FRAME_SANDBOX = 'allow-scripts allow-downloads allow-modals';

function newCellId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `ims-${crypto.randomUUID()}`
    : `ims-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function DiagramsSpikeScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const requested = params.get('ten') ?? '';
  const name = NAME_RE.test(requested) ? requested : DEFAULT_NAME;
  const [tab, setTab] = useState<'edit' | 'view'>('edit');
  const diagram = useQuery({
    queryKey: diagramKey(name),
    queryFn: () => apiFetch<DiagramView>(`/api/v1/diagram-spike/${name}`),
  });

  return (
    <>
      <PageHeader title={t('diagramSpike.title')} subtitle={t('diagramSpike.subtitle')} />
      <Tabs
        ariaLabel={t('diagramSpike.tabsLabel')}
        value={tab}
        onChange={(key) => setTab(key === 'view' ? 'view' : 'edit')}
        items={[
          { key: 'edit', label: t('diagramSpike.tabEdit') },
          { key: 'view', label: t('diagramSpike.tabView') },
        ]}
      />
      {diagram.isPending ? (
        <Loading />
      ) : diagram.isError ? (
        <LoadError error={diagram.error} onRetry={() => void diagram.refetch()} />
      ) : tab === 'edit' ? (
        <DiagramEditor me={me} name={name} saved={diagram.data} />
      ) : (
        <DiagramViewer saved={diagram.data} />
      )}
    </>
  );
}

function DiagramEditor({ me, name, saved }: { me: Me; name: string; saved: DiagramView }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState({ deviceId: '', term: '' });
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [inserting, setInserting] = useState(false);
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setStalled(true), FRAME_STALL_MS);
    return () => window.clearTimeout(timer);
  }, []);
  const guard = useUnsavedGuard(dirty);
  /*
   * Bản XML nạp lúc khung báo `init`: chụp một lần khi dựng. Lưu xong thì query làm mới `saved`,
   * nhưng khung đang mở đã có đúng nội dung đó rồi — nạp lại sẽ xoá lịch sử hoàn tác của người vẽ.
   */
  const [initialXml] = useState(saved.xml ?? '');
  const frameState = useRef<{ page: number; bounds: Bounds | null; pending: DeviceForDiagram | null }>({
    page: 0,
    bounds: null,
    pending: null,
  });

  const save = useApiMutation<{ xml: string }, DiagramView>(`/api/v1/diagram-spike/${name}`, {
    method: 'PUT',
    csrfToken: me.csrfToken,
    refreshMe: false,
  });

  const track = (message: DrawioMessage) => {
    const state = frameState.current;
    if (typeof message.currentPage === 'number') state.page = message.currentPage;
    if (message.modelBounds) state.bounds = message.modelBounds;
  };

  const insertInto = (xml: string, device: DeviceForDiagram) => {
    const state = frameState.current;
    const pages = pageIds(xml);
    const pageId = pages[Math.min(state.page, pages.length - 1)];
    if (!pageId) {
      toast({ tone: 'error', message: t('diagramSpike.insertFailed', { reason: 'page' }) });
      return;
    }
    const parent = layerIdOf(xml, pageId) ?? '1';
    const at = nextInsertPosition(state.bounds);
    const cell = deviceCellJson(device, {
      cellId: newCellId(),
      parent,
      previous: lastChildId(xml, pageId, parent),
      ...at,
    });
    post({ action: 'patch', patch: insertPatch(pageId, cell) });
    state.bounds = growBounds(state.bounds, { ...at, ...deviceCellSize(device.deviceTypeName) });
    setDirty(true);
    toast({ tone: 'ok', message: t('diagramSpike.inserted', { code: device.code }) });
  };

  const { frameRef, post } = useDrawioFrame((message) => {
    track(message);
    switch (message.event) {
      case 'configure':
        post({ action: 'configure', config: DRAWIO_CONFIG });
        break;
      case 'init':
        post({ action: 'load', xml: initialXml, autosave: 1, title: name });
        break;
      case 'load':
        setReady(true);
        break;
      case 'autosave':
        setDirty(true);
        break;
      case 'getDiff': {
        const device = frameState.current.pending;
        frameState.current.pending = null;
        if (device && message.xml) insertInto(message.xml, device);
        setInserting(false);
        break;
      }
      case 'patch':
        if (message.error) toast({ tone: 'error', message: t('diagramSpike.insertFailed', { reason: String(message.error) }) });
        break;
      case 'save':
        if (message.xml) {
          save.mutate(
            { xml: message.xml },
            {
              onSuccess: (view) => {
                setDirty(false);
                queryClient.setQueryData(diagramKey(name), view);
                toast({ tone: 'ok', message: t('diagramSpike.saved') });
              },
              onError: (error) => toast({ tone: 'error', message: errorMessage(error) }),
            },
          );
        }
        break;
    }
  });

  const insert = async () => {
    if (!picked.deviceId) return;
    setInserting(true);
    try {
      const [device, held] = await Promise.all([
        apiFetch<DeviceDetail>(`/api/v1/devices/${picked.deviceId}`),
        apiFetch<Record<string, string[]>>(`/api/v1/ipam/devices/addresses?deviceIds=${picked.deviceId}`),
      ]);
      frameState.current.pending = {
        id: device.id,
        code: device.code,
        name: device.name,
        deviceTypeName: device.deviceTypeName,
        ip: held[device.id]?.[0] ?? null,
      };
      // Hỏi draw.io bản đang mở (có cả phần chưa lưu) để biết trang và lớp đích; trả lời về ở `getDiff`.
      post({ action: 'getDiff' });
    } catch (error) {
      setInserting(false);
      toast({ tone: 'error', message: errorMessage(error) });
    }
  };

  const lastSaved = saved.updatedAt
    ? t('diagramSpike.savedAt', { at: formatDateTime(saved.updatedAt), by: saved.updatedBy ?? '' })
    : t('diagramSpike.neverSaved');

  return (
    <div className="ipam-split">
      <section className="card" aria-label={t('diagramSpike.stockTitle')}>
        <h2 className="form-section-title">{t('diagramSpike.stockTitle')}</h2>
        <p className="muted">{t('diagramSpike.stockHint')}</p>
        <Field label={t('diagramSpike.pick')}>
          <DeviceCombobox
            ariaLabel={t('diagramSpike.pick')}
            placeholder={t('diagramSpike.pickPlaceholder')}
            value={picked}
            onChange={(next) => setPicked({ deviceId: next.deviceId, term: next.term })}
            minChars={1}
          />
        </Field>
        <div className="row">
          <button
            type="button"
            className="btn"
            disabled={!ready || !picked.deviceId || inserting}
            onClick={() => void insert()}
          >
            {t('diagramSpike.insert')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!ready || save.isPending}
            onClick={() => post({ action: 'invokeAction', actionName: 'save' })}
          >
            {save.isPending ? t('diagramSpike.saving') : t('diagramSpike.save')}
          </button>
        </div>
        <p className="muted" role="status">
          {dirty ? t('diagramSpike.unsaved') : lastSaved}
        </p>
        {stalled && !ready ? (
          <p className="badge warn" role="alert">
            {t('diagramSpike.frameMissing')}
          </p>
        ) : null}
      </section>
      <iframe
        ref={frameRef}
        className="embed-frame"
        title={t('diagramSpike.frameTitle')}
        src={drawioUrl('edit')}
        sandbox={FRAME_SANDBOX}
      />
      {guard.blocked ? (
        <ConfirmDialog
          title={t('diagramSpike.leaveTitle')}
          message={t('diagramSpike.leaveMessage')}
          confirmLabel={t('diagramSpike.leaveDiscard')}
          cancelLabel={t('diagramSpike.leaveStay')}
          danger
          onConfirm={() => guard.proceed()}
          onCancel={() => guard.stay()}
        />
      ) : null}
    </div>
  );
}

function DiagramViewer({ saved }: { saved: DiagramView }) {
  const { t } = useTranslation();
  const xml = saved.xml ?? '';
  const refs = useMemo(() => parseDeviceRefs(xml), [xml]);
  const ids = useMemo(() => [...new Set(refs.map((r) => r.deviceId))], [refs]);
  const [selected, setSelected] = useState<string | null>(null);

  const live = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['devices', id],
      // Máy bị xoá hẳn khỏi kho (404) là một kiểu lệch kho, không phải lỗi của màn.
      queryFn: () =>
        apiFetch<DeviceDetail>(`/api/v1/devices/${id}`).catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        }),
    })),
  });
  const held = useQuery({
    queryKey: ['ipam', 'devices', 'addresses', ids],
    enabled: ids.length > 0,
    queryFn: () => apiFetch<Record<string, string[]>>(`/api/v1/ipam/devices/addresses?deviceIds=${ids.join(',')}`),
  });
  const settled = live.every((q) => !q.isPending) && (ids.length === 0 || !held.isPending);

  const liveById = new Map(ids.map((id, i) => [id, live[i]?.data ?? null]));
  const drift = new Map<string, DriftReason[]>();
  for (const ref of refs) {
    const device = liveById.get(ref.deviceId);
    const reasons = driftReasons(
      ref,
      device ? { code: device.code, status: device.status, ips: held.data?.[ref.deviceId] ?? [] } : null,
    );
    drift.set(ref.cellId, reasons);
  }
  const warned = new Set(refs.filter((r) => (drift.get(r.cellId) ?? []).length > 0).map((r) => r.deviceId));
  const warnedKey = [...warned].sort().join(',');
  const viewXml = useMemo(
    () => withViewerMarks(xml, window.location.origin, new Set(warnedKey ? warnedKey.split(',') : [])),
    [xml, warnedKey],
  );

  const { frameRef, post } = useDrawioFrame((message) => {
    if (message.event === 'configure') post({ action: 'configure', config: DRAWIO_CONFIG });
    else if (message.event === 'init') post({ action: 'load', xml: viewXml });
    else if (message.event === 'openLink' && message.href) {
      const id = deviceIdFromLink(message.href, window.location.origin);
      if (id) setSelected(id);
    }
  });

  if (!saved.xml) return <EmptyState title={t('diagramSpike.emptyTitle')} hint={t('diagramSpike.emptyHint')} />;

  const card = selected ? liveById.get(selected) : null;
  const cardRef = selected ? refs.find((r) => r.deviceId === selected) : undefined;

  return (
    <div className="ipam-split">
      <section className="card" aria-label={t('diagramSpike.onDiagram', { count: ids.length })}>
        <h2 className="form-section-title">{t('diagramSpike.onDiagram', { count: ids.length })}</h2>
        {isCompressed(xml) ? <p className="badge warn">{t('diagramSpike.compressed')}</p> : null}
        {refs.length === 0 ? (
          <p className="muted">{t('diagramSpike.noDevices')}</p>
        ) : (
          <ul className="chip-list" aria-label={t('diagramSpike.onDiagram', { count: ids.length })}>
            {refs.map((ref) => {
              const reasons = drift.get(ref.cellId) ?? [];
              return (
                <li key={ref.cellId}>
                  <button type="button" className="btn" aria-pressed={selected === ref.deviceId} onClick={() => setSelected(ref.deviceId)}>
                    <span className="mono">{ref.code}</span>
                  </button>{' '}
                  {!settled ? null : reasons.length === 0 ? (
                    <span className="badge ok">{t('diagramSpike.matched')}</span>
                  ) : (
                    reasons.map((reason) => (
                      <span key={reason} className="badge warn">
                        {t(DRIFT_KEY[reason])}
                      </span>
                    ))
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="muted">{t('diagramSpike.clickHint')}</p>
        {selected ? (
          <section aria-label={t('diagramSpike.card.title')}>
            <h3 className="form-section-title">{t('diagramSpike.card.title')}</h3>
            {card ? (
              <dl>
                <dt>{t('diagramSpike.card.code')}</dt>
                <dd className="mono">{card.code}</dd>
                <dt>{t('diagramSpike.card.name')}</dt>
                <dd>{card.name}</dd>
                <dt>{t('diagramSpike.card.ip')}</dt>
                <dd className="mono">
                  {(held.data?.[card.id] ?? []).join(', ') || '—'}
                  {cardRef?.ip ? <small> · {t('diagramSpike.card.ipAtInsert', { ip: cardRef.ip })}</small> : null}
                </dd>
                <dt>{t('diagramSpike.card.location')}</dt>
                <dd>
                  <LocationText device={card} />
                </dd>
                <dt>{t('diagramSpike.card.status')}</dt>
                <dd>{STATUS_KEY[card.status] ? t(STATUS_KEY[card.status]) : card.status}</dd>
              </dl>
            ) : (
              <p className="muted">{t('diagramSpike.card.loadFailed')}</p>
            )}
            {card ? <Link to={PATHS.device(card.id)}>{t('diagramSpike.card.open')}</Link> : null}
          </section>
        ) : null}
      </section>
      {settled ? (
        <iframe
          key={warnedKey}
          ref={frameRef}
          className="embed-frame"
          title={t('diagramSpike.viewerTitle')}
          src={drawioUrl('view')}
          sandbox={FRAME_SANDBOX}
        />
      ) : (
        <Loading />
      )}
    </div>
  );
}
