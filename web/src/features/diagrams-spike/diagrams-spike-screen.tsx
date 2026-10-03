import { useMemo, useRef, useState, type ReactNode } from 'react';
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
import { Dialog } from '@/ui/dialog';
import { DrawioFrame, type DrawioFrameHandle } from '@/ui/drawio-frame';
import type { DrawioEvent } from '@/ui/drawio-protocol';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { LocationText } from '@/ui/location-text';
import { Tabs } from '@/ui/tabs';
import { useToast } from '@/ui/toast';
import { useUnsavedGuard } from '@/ui/use-unsaved-guard';
import {
  deviceCellJson,
  deviceCellSize,
  deviceIdFromLink,
  driftReasons,
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
  type DriftReason,
} from './drawio-bridge';

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

interface EditorSettings {
  initTimeoutSeconds: number;
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

const diagramKey = (name: string) => ['diagram-spike', name] as const;

function newCellId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `ims-${crypto.randomUUID()}`
    : `ims-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Màn sơ đồ (bản thử) theo bố cục Q-23: shell thu sidebar (`isCompactShellPath`), màn chiếm phần
 * còn lại — MỘT thanh mảnh phía trên (tab Sửa/Xem + nút IMS), dưới là trình vẽ. Không cột panel:
 * chức năng phụ là hộp tìm gọn trên thanh hoặc hộp thoại dùng chung.
 */
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
  const settings = useQuery({
    queryKey: ['diagrams', 'editor-settings'],
    queryFn: () => apiFetch<EditorSettings>('/api/v1/diagrams/editor-settings'),
    staleTime: 60_000,
  });

  const tabs = (
    <Tabs
      ariaLabel={t('diagramSpike.tabsLabel')}
      value={tab}
      onChange={(key) => setTab(key === 'view' ? 'view' : 'edit')}
      items={[
        { key: 'edit', label: t('diagramSpike.tabEdit') },
        { key: 'view', label: t('diagramSpike.tabView') },
      ]}
    />
  );

  if (diagram.isPending || settings.isPending) return <ScreenFrame tabs={tabs} body={<Loading />} />;
  if (diagram.isError || settings.isError) {
    const error = diagram.error ?? settings.error;
    return (
      <ScreenFrame
        tabs={tabs}
        body={
          <LoadError
            error={error}
            onRetry={() => {
              void diagram.refetch();
              void settings.refetch();
            }}
          />
        }
      />
    );
  }
  return tab === 'edit' ? (
    <DiagramEditor me={me} name={name} saved={diagram.data} settings={settings.data} tabs={tabs} />
  ) : (
    <DiagramViewer me={me} saved={diagram.data} settings={settings.data} tabs={tabs} />
  );
}

/** Thanh mảnh + vùng trình vẽ. `actions` là nút/hộp tìm của IMS trên thanh. */
function ScreenFrame({ tabs, actions, status, body }: { tabs: ReactNode; actions?: ReactNode; status?: ReactNode; body: ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="full-bar">
        <h1 className="full-bar-title">{t('diagramSpike.title')}</h1>
        {tabs}
        {actions ? <div className="full-bar-actions">{actions}</div> : null}
        {status ? <div className="full-bar-status">{status}</div> : null}
      </div>
      <div className="full-stage">{body}</div>
    </>
  );
}

function DiagramEditor({
  me,
  name,
  saved,
  settings,
  tabs,
}: {
  me: Me;
  name: string;
  saved: DiagramView;
  settings: EditorSettings;
  tabs: ReactNode;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const frame = useRef<DrawioFrameHandle>(null);
  const [picked, setPicked] = useState({ deviceId: '', term: '' });
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [inserting, setInserting] = useState(false);
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
    frame.current?.send({ action: 'patch', patch: insertPatch(pageId, cell) });
    state.bounds = growBounds(state.bounds, { ...at, ...deviceCellSize(device.deviceTypeName) });
    setDirty(true);
    toast({ tone: 'ok', message: t('diagramSpike.inserted', { code: device.code }) });
  };

  const onEvent = (message: DrawioEvent) => {
    const state = frameState.current;
    if (typeof message.currentPage === 'number') state.page = message.currentPage;
    if (message.modelBounds) state.bounds = message.modelBounds;
    switch (message.event) {
      case 'load':
        setReady(true);
        break;
      case 'autosave':
        setDirty(true);
        break;
      case 'getDiff': {
        const device = state.pending;
        state.pending = null;
        if (device && message.xml) insertInto(message.xml, device);
        setInserting(false);
        break;
      }
      case 'patch':
        if (message.error) toast({ tone: 'error', message: t('diagramSpike.insertFailed', { reason: message.error }) });
        break;
      case 'save':
        save.mutate(
          { xml: message.xml ?? '' },
          {
            onSuccess: (view) => {
              setDirty(false);
              queryClient.setQueryData(diagramKey(name), view);
              toast({ tone: 'ok', message: t('diagramSpike.saved') });
            },
            onError: (error) => toast({ tone: 'error', message: errorMessage(error) }),
          },
        );
        break;
    }
  };

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
      frame.current?.send({ action: 'getDiff' });
    } catch (error) {
      setInserting(false);
      toast({ tone: 'error', message: errorMessage(error) });
    }
  };

  const lastSaved = saved.updatedAt
    ? t('diagramSpike.savedAt', { at: formatDateTime(saved.updatedAt), by: saved.updatedBy ?? '' })
    : t('diagramSpike.neverSaved');

  return (
    <ScreenFrame
      tabs={tabs}
      actions={
        <>
          <div className="full-bar-search">
            <DeviceCombobox
              ariaLabel={t('diagramSpike.pick')}
              placeholder={t('diagramSpike.pickPlaceholder')}
              value={picked}
              onChange={(next) => setPicked({ deviceId: next.deviceId, term: next.term })}
              minChars={1}
            />
          </div>
          <button type="button" className="btn" disabled={!ready || !picked.deviceId || inserting} onClick={() => void insert()}>
            {t('diagramSpike.insert')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!ready || save.isPending}
            onClick={() => frame.current?.send({ action: 'save' })}
          >
            {save.isPending ? t('diagramSpike.saving') : t('diagramSpike.save')}
          </button>
        </>
      }
      status={
        <p className="muted" role="status">
          {dirty ? t('diagramSpike.unsaved') : lastSaved}
        </p>
      }
      body={
        <>
          <DrawioFrame
            ref={frame}
            mode="edit"
            title={t('diagramSpike.frameTitle')}
            initialXml={initialXml}
            viewer={me}
            initTimeoutSeconds={settings.initTimeoutSeconds}
            onEvent={onEvent}
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
        </>
      }
    />
  );
}

function DiagramViewer({ me, saved, settings, tabs }: { me: Me; saved: DiagramView; settings: EditorSettings; tabs: ReactNode }) {
  const { t } = useTranslation();
  const xml = saved.xml ?? '';
  const refs = useMemo(() => parseDeviceRefs(xml), [xml]);
  const ids = useMemo(() => [...new Set(refs.map((r) => r.deviceId))], [refs]);
  const [selected, setSelected] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);

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
    drift.set(
      ref.cellId,
      driftReasons(ref, device ? { code: device.code, status: device.status, ips: held.data?.[ref.deviceId] ?? [] } : null),
    );
  }
  const warned = new Set(refs.filter((r) => (drift.get(r.cellId) ?? []).length > 0).map((r) => r.deviceId));
  const warnedKey = [...warned].sort().join(',');
  const viewXml = useMemo(
    () => withViewerMarks(xml, window.location.origin, new Set(warnedKey ? warnedKey.split(',') : [])),
    [xml, warnedKey],
  );

  const onEvent = (message: DrawioEvent) => {
    if (message.event === 'openLink' && message.href) {
      const id = deviceIdFromLink(message.href, window.location.origin);
      if (id) setSelected(id);
    }
  };

  if (!saved.xml) {
    return <ScreenFrame tabs={tabs} body={<EmptyState title={t('diagramSpike.emptyTitle')} hint={t('diagramSpike.emptyHint')} />} />;
  }

  const card = selected ? liveById.get(selected) : null;
  const cardRef = selected ? refs.find((r) => r.deviceId === selected) : undefined;

  return (
    <ScreenFrame
      tabs={tabs}
      actions={
        <button type="button" className="btn" onClick={() => setListOpen(true)}>
          {t('diagramSpike.onDiagram', { count: ids.length })}
          {settled && warned.size > 0 ? <span className="badge warn">{t('diagramSpike.driftCount', { count: warned.size })}</span> : null}
        </button>
      }
      status={isCompressed(xml) ? <p className="badge warn">{t('diagramSpike.compressed')}</p> : null}
      body={
        <>
          {settled ? (
            <DrawioFrame
              key={warnedKey}
              mode="view"
              title={t('diagramSpike.viewerTitle')}
              initialXml={viewXml}
              viewer={me}
              initTimeoutSeconds={settings.initTimeoutSeconds}
              onEvent={onEvent}
            />
          ) : (
            <Loading />
          )}
          <Dialog open={listOpen} onOpenChange={setListOpen} title={t('diagramSpike.onDiagram', { count: ids.length })}>
            {refs.length === 0 ? (
              <p className="muted">{t('diagramSpike.noDevices')}</p>
            ) : (
              <ul className="chip-list">
                {refs.map((ref) => {
                  const reasons = drift.get(ref.cellId) ?? [];
                  return (
                    <li key={ref.cellId}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          setListOpen(false);
                          setSelected(ref.deviceId);
                        }}
                      >
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
          </Dialog>
          <Dialog open={selected !== null} onOpenChange={(open) => (open ? null : setSelected(null))} title={t('diagramSpike.card.title')}>
            {card ? (
              <>
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
                <Link to={PATHS.device(card.id)}>{t('diagramSpike.card.open')}</Link>
              </>
            ) : (
              <p className="muted">{t('diagramSpike.card.loadFailed')}</p>
            )}
          </Dialog>
        </>
      }
    />
  );
}
