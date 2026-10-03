import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { BREAKPOINTS } from '@/ui/breakpoints';
import { useConfirm } from '@/ui/confirm-provider';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { DeviceCombobox } from '@/ui/device-combobox';
import { DiagramViewer } from '@/ui/diagram-viewer';
import { DrawioFrame, type DrawioFrameHandle } from '@/ui/drawio-frame';
import { exportedSvgText, type DrawioEvent } from '@/ui/drawio-protocol';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Tabs } from '@/ui/tabs';
import { useToast } from '@/ui/toast';
import { useMediaQuery } from '@/ui/use-media-query';
import { isStepUpCancelled, useStepUpRetry } from '@/ui/use-step-up-retry';
import { useUnsavedGuard } from '@/ui/use-unsaved-guard';
import {
  SETTINGS_KEY,
  TREE_KEY,
  contentKey,
  historyKey,
  nodeKey,
  versionsKey,
  type DiagramContent,
  type DiagramNode,
  type EditorSettings,
  type VersionItem,
} from './diagram-api';
import { DiagramVersionsDialog } from './diagram-versions-dialog';
import {
  deviceCellJson,
  deviceCellSize,
  growBounds,
  insertPatch,
  lastChildId,
  layerIdOf,
  nextInsertPosition,
  pageIds,
  type Bounds,
  type DeviceForDiagram,
} from './drawio-bridge';

interface DeviceDetail {
  id: string;
  code: string;
  name: string;
  deviceTypeName: string;
}

type Mode = 'view' | 'edit';

function newCellId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `ims-${crypto.randomUUID()}`
    : `ims-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Màn mở MỘT bản vẽ (Q-23, AD-17): shell thu sidebar, một thanh mảnh phía trên (tab Xem/Sửa +
 * nút IMS), dưới là trình xem SVG hoặc trình vẽ draw.io chiếm phần còn lại.
 *
 * Tên bản vẽ đọc không cần mã; NỘI DUNG (mọi phiên bản) đòi mã phạm vi sơ đồ — server trả
 * `STEPUP_REQUIRED` thì hộp nhập mã mở tại chỗ, trong ân hạn thì mở bản vẽ khác không hỏi lại.
 */
export function DiagramScreen({ me }: { me: Me }) {
  const { id = '' } = useParams();
  // Mỗi bản vẽ một lần dựng: sang bản vẽ khác thì trạng thái "đang sửa dở" không đi theo.
  return <DiagramScreenFor key={id} me={me} id={id} />;
}

function DiagramScreenFor({ me, id }: { me: Me; id: string }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get('mode') === 'edit' ? 'edit' : 'view';
  const versionId = mode === 'view' ? params.get('version') : null;
  const narrow = useMediaQuery(BREAKPOINTS.editor);
  const ask = useConfirm();
  const queryClient = useQueryClient();
  const stepUp = useStepUpRetry(me.csrfToken);
  const [dirty, setDirty] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);

  const node = useQuery({ queryKey: nodeKey(id), queryFn: () => apiFetch<DiagramNode>(`/api/v1/diagrams/${id}`) });
  const settings = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => apiFetch<EditorSettings>('/api/v1/diagrams/editor-settings'),
    staleTime: 60_000,
  });
  const editBlocked = mode === 'edit' && narrow;
  const content = useQuery({
    queryKey: contentKey(id, mode, versionId),
    queryFn: () => {
      const query = new URLSearchParams({ mode });
      if (versionId) query.set('versionId', versionId);
      return stepUp.run(
        () => apiFetch<DiagramContent>(`/api/v1/diagrams/${id}/content?${query.toString()}`),
        t('diagrams.screen.stepUpPurpose', { name: node.data?.name ?? '' }),
      );
    },
    enabled: node.isSuccess && !editBlocked,
    // Mỗi lần tải nội dung là một dòng `diagram.viewed`: không tự tải lại khi quay lại tab trình duyệt.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  const switchMode = async (next: Mode) => {
    if (next === mode) return;
    if (dirty) {
      const ok = await ask({
        title: t('diagrams.screen.leaveTitle'),
        message: t('diagrams.screen.leaveMessage'),
        confirmLabel: t('diagrams.screen.leaveDiscard'),
        cancelLabel: t('diagrams.screen.leaveStay'),
        danger: true,
      });
      if (!ok) return;
      setDirty(false);
    }
    setParams(next === 'edit' ? { mode: 'edit' } : {});
  };

  const tabs = (
    <Tabs
      ariaLabel={t('diagrams.screen.tabsLabel')}
      value={mode}
      onChange={(key) => void switchMode(key === 'edit' ? 'edit' : 'view')}
      items={[
        { key: 'view', label: t('diagrams.screen.tabView') },
        { key: 'edit', label: t('diagrams.screen.tabEdit') },
      ]}
    />
  );
  const title = node.data?.name ?? t('diagrams.title');
  const versionsButton = (
    <button type="button" className="btn" disabled={!content.isSuccess} onClick={() => setVersionsOpen(true)}>
      {t('diagrams.screen.versions')}
    </button>
  );
  const dialogs = (
    <>
      {stepUp.dialog}
      {versionsOpen && node.data ? (
        <DiagramVersionsDialog
          me={me}
          diagram={node.data}
          run={stepUp.run}
          onRestored={() =>
            // Đang vẽ dở thì không nạp bản khôi phục đè lên khung: lượt lưu sau sẽ ghi "lưu đè".
            void queryClient.invalidateQueries({ queryKey: ['diagram-content', id], refetchType: dirty ? 'none' : 'active' })
          }
          onView={(version) => {
            setVersionsOpen(false);
            void (async () => {
              if (mode === 'edit' && dirty) {
                const ok = await ask({
                  title: t('diagrams.screen.leaveTitle'),
                  message: t('diagrams.screen.leaveMessage'),
                  confirmLabel: t('diagrams.screen.leaveDiscard'),
                  cancelLabel: t('diagrams.screen.leaveStay'),
                  danger: true,
                });
                if (!ok) return;
                setDirty(false);
              }
              setParams({ version: version.id });
            })();
          }}
          onClose={() => setVersionsOpen(false)}
        />
      ) : null}
    </>
  );

  let body: ReactNode;
  let actions: ReactNode = versionsButton;
  let status: ReactNode = null;
  if (node.isPending || settings.isPending) body = <Loading />;
  else if (node.isError || settings.isError) {
    body = (
      <LoadError
        error={node.error ?? settings.error}
        onRetry={() => {
          void node.refetch();
          void settings.refetch();
        }}
      />
    );
  } else if (editBlocked) {
    body = (
      <EmptyState
        title={t('diagrams.screen.desktopOnly')}
        hint={t('diagrams.screen.desktopOnlyHint')}
        action={
          <button type="button" className="btn primary" onClick={() => setParams({})}>
            {t('diagrams.screen.goView')}
          </button>
        }
      />
    );
    actions = null;
  } else if (content.isPending) body = <Loading />;
  else if (content.isError) {
    body = isStepUpCancelled(content.error) ? (
      <EmptyState
        title={t('diagrams.screen.locked')}
        hint={t('diagrams.screen.lockedHint')}
        action={
          <button type="button" className="btn primary" onClick={() => void content.refetch()}>
            {t('diagrams.screen.unlock')}
          </button>
        }
      />
    ) : (
      <LoadError error={content.error} onRetry={() => void content.refetch()} />
    );
  } else if (mode === 'edit') {
    return (
      <DiagramEditor
        key={content.data.version?.id ?? 'new'}
        me={me}
        diagramId={id}
        title={title}
        tabs={tabs}
        versionsButton={versionsButton}
        dialogs={dialogs}
        content={content.data}
        settings={settings.data}
        onDirtyChange={setDirty}
      />
    );
  } else if (!content.data.version?.svg) {
    body = <EmptyState title={t('diagrams.screen.noVersionTitle')} hint={t('diagrams.screen.noVersionHint')} />;
  } else {
    const version = content.data.version;
    body = <DiagramViewer svg={version.svg ?? ''} viewer={me} title={t('diagrams.screen.viewerTitle')} />;
    if (versionId) {
      status = (
        <p className="muted" role="status">
          {t('diagrams.screen.viewingOld', { seq: version.seq, at: formatDateTime(version.savedAt) })}{' '}
          <button type="button" className="btn sm" onClick={() => setParams({})}>
            {t('diagrams.screen.backToLatest')}
          </button>
        </p>
      );
    }
  }

  return <ScreenFrame title={title} tabs={tabs} actions={actions} status={status} body={body} dialogs={dialogs} />;
}

/** Thanh mảnh + vùng trình vẽ/trình xem. Không cột panel (Q-23). */
function ScreenFrame({
  title,
  tabs,
  actions,
  status,
  body,
  dialogs,
}: {
  title: string;
  tabs: ReactNode;
  actions?: ReactNode;
  status?: ReactNode;
  body: ReactNode;
  dialogs?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="full-bar">
        <Link to={PATHS.diagrams} className="linkbtn sm">
          {t('diagrams.screen.backToTree')}
        </Link>
        <h1 className="full-bar-title">{title}</h1>
        {tabs}
        {actions ? <div className="full-bar-actions">{actions}</div> : null}
        {status ? <div className="full-bar-status">{status}</div> : null}
      </div>
      <div className="full-stage">{body}</div>
      {dialogs}
    </>
  );
}

function DiagramEditor({
  me,
  diagramId,
  title,
  tabs,
  versionsButton,
  dialogs,
  content,
  settings,
  onDirtyChange,
}: {
  me: Me;
  diagramId: string;
  title: string;
  tabs: ReactNode;
  versionsButton: ReactNode;
  dialogs: ReactNode;
  content: DiagramContent;
  settings: EditorSettings;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const frame = useRef<DrawioFrameHandle>(null);
  const [ready, setReady] = useState(false);
  const [dirty, setDirtyState] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<VersionItem | null>(content.version);
  const [others, setOthers] = useState<{ fullName: string }[]>([]);
  const [picked, setPicked] = useState({ deviceId: '', term: '' });
  const [inserting, setInserting] = useState(false);
  const guard = useUnsavedGuard(dirty);
  /*
   * XML nạp lúc khung báo `init` và phiên bản gốc của lượt lưu kế tiếp. Lưu xong KHÔNG nạp lại
   * khung (xoá lịch sử hoàn tác của người vẽ) — chỉ dời mốc gốc sang phiên bản vừa tạo, để lượt
   * lưu sau của chính người này không bị ghi là "lưu đè".
   */
  const [initialXml] = useState(content.version?.xml ?? '');
  const basedOn = useRef<string | null>(content.version?.id ?? null);
  const pendingXml = useRef<string | null>(null);
  const frameState = useRef<{ page: number; bounds: Bounds | null; pending: DeviceForDiagram | null }>({
    page: 0,
    bounds: null,
    pending: null,
  });

  const setDirty = (value: boolean) => {
    setDirtyState(value);
    onDirtyChange(value);
  };

  const save = useApiMutation<{ xml: string; svg: string; basedOnVersionId: string | null }, VersionItem>(
    `/api/v1/diagrams/${diagramId}/versions`,
    { csrfToken: me.csrfToken, refreshMe: false },
  );

  // Nhịp "đang mở sửa" (Q-23): nửa thời gian giữ một lần, để một nhịp lỡ không làm tên biến mất.
  useEffect(() => {
    let alive = true;
    const beat = () =>
      apiFetch<{ others: { fullName: string }[] }>(`/api/v1/diagrams/${diagramId}/presence`, {
        method: 'POST',
        csrfToken: me.csrfToken,
      })
        .then((res) => alive && setOthers(res.others))
        .catch(() => undefined);
    void beat();
    const timer = window.setInterval(() => void beat(), Math.max(10, settings.presenceTtlSeconds / 2) * 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [diagramId, me.csrfToken, settings.presenceTtlSeconds]);

  const submit = (xml: string, svg: string) => {
    save.mutate(
      { xml, svg, basedOnVersionId: basedOn.current },
      {
        onSuccess: (version) => {
          basedOn.current = version.id;
          setLastSaved(version);
          setDirty(false);
          void queryClient.invalidateQueries({ queryKey: TREE_KEY });
          void queryClient.invalidateQueries({ queryKey: nodeKey(diagramId) });
          void queryClient.invalidateQueries({ queryKey: versionsKey(diagramId) });
          void queryClient.invalidateQueries({ queryKey: historyKey(diagramId) });
          /*
           * Nội dung đã cache (Xem, và Sửa của chính màn này) đã cũ: đánh dấu để lần MỞ sau tải
           * lại, nhưng không tải ngay — tải ngay là nạp lại khung đang vẽ.
           */
          void queryClient.invalidateQueries({ queryKey: ['diagram-content', diagramId], refetchType: 'none' });
          toast({ tone: 'ok', message: t('diagrams.screen.saved', { seq: version.seq, summary: version.summary }) });
        },
        onError: (error) => toast({ tone: 'error', message: errorMessage(error) }),
        onSettled: () => setSaving(false),
      },
    );
  };

  const insertInto = (xml: string, device: DeviceForDiagram) => {
    const state = frameState.current;
    const pages = pageIds(xml);
    const pageId = pages[Math.min(state.page, pages.length - 1)];
    if (!pageId) {
      toast({ tone: 'error', message: t('diagrams.screen.insertFailed', { reason: 'page' }) });
      return;
    }
    const parent = layerIdOf(xml, pageId) ?? '1';
    const at = nextInsertPosition(state.bounds);
    const cell = deviceCellJson(device, { cellId: newCellId(), parent, previous: lastChildId(xml, pageId, parent), ...at });
    frame.current?.send({ action: 'patch', patch: insertPatch(pageId, cell) });
    state.bounds = growBounds(state.bounds, { ...at, ...deviceCellSize(device.deviceTypeName) });
    setDirty(true);
    toast({ tone: 'ok', message: t('diagrams.screen.inserted', { code: device.code }) });
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
        if (message.error) toast({ tone: 'error', message: t('diagrams.screen.insertFailed', { reason: message.error }) });
        break;
      case 'save':
        // Lưu = XML + ảnh SVG để xem: xin trình vẽ xuất SVG, gửi cả hai khi `export` về.
        pendingXml.current = message.xml ?? '';
        setSaving(true);
        frame.current?.send({ action: 'export', format: 'svg' });
        break;
      case 'export': {
        const xml = pendingXml.current;
        pendingXml.current = null;
        if (xml === null) break;
        const svg = exportedSvgText(message.data ?? '');
        if (!svg.value) {
          setSaving(false);
          toast({ tone: 'error', message: t('diagrams.screen.saveFailed') });
          break;
        }
        submit(xml, svg.value);
        break;
      }
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

  const busy = saving || save.isPending;
  const status = (
    <>
      {others.length > 0 ? (
        <p className="badge warn" role="status">
          {t('diagrams.screen.presence', { names: others.map((o) => o.fullName).join(', ') })}
        </p>
      ) : null}
      <p className="muted" role="status">
        {dirty
          ? t('diagrams.screen.unsaved')
          : lastSaved
            ? t('diagrams.screen.savedAt', {
                seq: lastSaved.seq,
                at: formatDateTime(lastSaved.savedAt),
                by: lastSaved.savedByName ?? lastSaved.savedBy,
              })
            : t('diagrams.screen.neverSaved')}
      </p>
    </>
  );

  return (
    <ScreenFrame
      title={title}
      tabs={tabs}
      dialogs={dialogs}
      actions={
        <>
          <div className="full-bar-search">
            <DeviceCombobox
              ariaLabel={t('diagrams.screen.pick')}
              placeholder={t('diagrams.screen.pickPlaceholder')}
              value={picked}
              onChange={(next) => setPicked({ deviceId: next.deviceId, term: next.term })}
              minChars={1}
            />
          </div>
          <button type="button" className="btn" disabled={!ready || !picked.deviceId || inserting} onClick={() => void insert()}>
            {t('diagrams.screen.insert')}
          </button>
          <button type="button" className="btn primary" disabled={!ready || busy} onClick={() => frame.current?.send({ action: 'save' })}>
            {busy ? t('diagrams.screen.saving') : t('diagrams.screen.save')}
          </button>
          {versionsButton}
        </>
      }
      status={status}
      body={
        <>
          <DrawioFrame
            ref={frame}
            mode="edit"
            title={t('diagrams.screen.frameTitle')}
            initialXml={initialXml}
            viewer={me}
            initTimeoutSeconds={settings.initTimeoutSeconds}
            onEvent={onEvent}
          />
          {guard.blocked ? (
            <ConfirmDialog
              title={t('diagrams.screen.leaveTitle')}
              message={t('diagrams.screen.leaveMessage')}
              confirmLabel={t('diagrams.screen.leaveDiscard')}
              cancelLabel={t('diagrams.screen.leaveStay')}
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
