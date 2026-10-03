import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { BREAKPOINTS } from '@/ui/breakpoints';
import { useConfirm } from '@/ui/confirm-provider';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { DiagramViewer, type ViewerCell } from '@/ui/diagram-viewer';
import { DrawioFrame, readCablePalette, type DrawioFrameHandle } from '@/ui/drawio-frame';
import { exportedSvgText, paintImsXml, type DrawioEvent } from '@/ui/drawio-protocol';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Popover } from '@/ui/popover';
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
  type CableEdge,
  type DiagramDeviceInfo,
  type DiagramLink,
  type DiagramNode,
  type EditorSettings,
  type VersionItem,
} from './diagram-api';
import { CableLegend } from './cable-legend';
import { DeviceConnections, DiagramCableCard } from './diagram-cable-card';
import { DiagramDeviceCard } from './diagram-device-card';
import { PinModeToggle, useDiagramReview } from './diagram-review';
import { DiagramVersionsDialog } from './diagram-versions-dialog';
import {
  deviceIdsInXml,
  insertPatch,
  lastChildId,
  layerIdOf,
  pageIds,
  placeCells,
  type Bounds,
  type DeviceCellSpec,
} from './drawio-bridge';
import { DraftFromPortMapDialog } from './draft-from-port-map-dialog';
import { StockDevicePicker } from './stock-device-picker';
import { useCableBridge } from './use-cable-bridge';

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
  const [cardCellId, setCardCellId] = useState<string | null>(null);
  /*
   * Tô sáng ở chế độ xem: máy đang được "bấm" (dây của nó + máy đầu kia sáng). Mở từ mũi tên "→ máy
   * (bản vẽ khác)" thì `?focus=<id máy>` chọn sẵn máy đó và bay tới.
   */
  const [focusDeviceId, setFocusDeviceId] = useState<string | null>(() => params.get('focus'));

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

  /*
   * Bay tới một ô (ghim, lời báo tự kiểm). Trình vẽ draw.io không nhận lệnh "bay tới", nên ở chế
   * độ Sửa thì sang chế độ Xem với `?cell=` (hỏi trước nếu đang vẽ dở). Không dùng `?focus=`: tham số
   * đó là id MÁY để tô sáng (mũi tên "→ máy (bản vẽ khác)"), còn đây là id Ô.
   */
  const [focusCell, setFocusCell] = useState<string | null>(params.get('cell'));
  const goToCell = (cellId: string) => {
    if (mode === 'view') {
      setFocusCell(null);
      window.setTimeout(() => setFocusCell(cellId), 0);
      return;
    }
    void (async () => {
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
      setFocusCell(cellId);
      setParams({ cell: cellId });
    })();
  };
  const review = useDiagramReview({
    me,
    diagram: node.data ?? null,
    run: stepUp.run,
    versionId: content.data?.version?.id ?? null,
    dirty,
    onGoToCell: goToCell,
  });

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
      {review.dialogs}
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
  let actions: ReactNode = (
    <>
      {review.actions}
      {versionsButton}
    </>
  );
  let status: ReactNode = review.status;
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
        reviewActions={review.actions}
        dialogs={dialogs}
        content={content.data}
        settings={settings.data}
        run={stepUp.run}
        onDirtyChange={setDirty}
      />
    );
  } else if (!content.data.version?.svg) {
    body = <EmptyState title={t('diagrams.screen.noVersionTitle')} hint={t('diagrams.screen.noVersionHint')} />;
  } else {
    const version = content.data.version;
    const view = viewerCells(content.data, t);
    const card = cardCellId ? view.byCell.get(cardCellId) : undefined;
    actions = (
      <>
        <PinModeToggle active={review.pinMode} onToggle={review.togglePinMode} />
        {actions}
      </>
    );
    const edgeCard = cardCellId ? view.byEdge.get(cardCellId) : undefined;
    const focus = focusDeviceId ? focusCells(content.data, focusDeviceId) : null;
    const focusCode = focusDeviceId ? ((content.data.deviceCells ?? []).find((c) => c.deviceId === focusDeviceId)?.code ?? '') : '';
    body = (
      <>
        <DiagramViewer
          svg={version.svg ?? ''}
          viewer={me}
          title={t('diagrams.screen.viewerTitle')}
          cells={view.cells}
          selectedCellId={cardCellId ?? focusCell}
          onCellClick={
            review.pinMode
              ? review.viewer.onPickCell
              : (cellId) => {
                  setCardCellId(cellId);
                  const deviceId = view.byCell.get(cellId)?.device?.id ?? (content.data.deviceCells ?? []).find((c) => c.cellId === cellId)?.deviceId;
                  if (deviceId) setFocusDeviceId(deviceId);
                }
          }
          pickAnyCell={review.viewer.pickAnyCell}
          pins={review.viewer.pins}
          onPinClick={review.viewer.onPinClick}
          focusCellId={focusCell ?? (focus && params.get('focus') ? focus[0] : null)}
          highlightCellIds={focus}
        />
        {(content.data.cableEdges ?? []).length > 0 ? <CableLegend cableTypes={content.data.cableTypes ?? []} floating /> : null}
        {card ? (
          <DiagramDeviceCard me={me} device={card.device} code={card.code} diagramId={id} onClose={() => setCardCellId(null)}>
            {card.device?.found ? (
              <DeviceConnections
                deviceId={card.device.id}
                diagramId={id}
                links={content.data.links ?? []}
                onDrawing={new Set((content.data.deviceCells ?? []).map((c) => c.deviceId))}
              />
            ) : null}
          </DiagramDeviceCard>
        ) : null}
        {edgeCard ? (
          <DiagramCableCard edge={edgeCard.edge} link={edgeCard.link} cableTypes={content.data.cableTypes ?? []} onClose={() => setCardCellId(null)} />
        ) : null}
      </>
    );
    const pendingVersion = review.review?.versionId ?? null;
    if (pendingVersion && pendingVersion !== version.id) {
      status = (
        <>
          {status}
          <button type="button" className="btn sm" onClick={() => setParams({ version: pendingVersion })}>
            {t('diagrams.review.viewPending')}
          </button>
        </>
      );
    }
    if (focusDeviceId && focus) {
      status = (
        <>
          {status}
          <p className="muted" role="status">
            {t('diagrams.cable.highlighting', { code: focusCode })}{' '}
            <button type="button" className="btn sm" onClick={() => setFocusDeviceId(null)}>
              {t('diagrams.cable.clearHighlight')}
            </button>
          </p>
        </>
      );
    }
    if (versionId) {
      status = (
        <>
          {status}
          <p className="muted" role="status">
            {t('diagrams.screen.viewingOld', { seq: version.seq, at: formatDateTime(version.savedAt) })}{' '}
            <button type="button" className="btn sm" onClick={() => setParams({})}>
              {t('diagrams.screen.backToLatest')}
            </button>
          </p>
        </>
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
  reviewActions,
  dialogs,
  content,
  settings,
  run,
  onDirtyChange,
}: {
  me: Me;
  diagramId: string;
  title: string;
  tabs: ReactNode;
  versionsButton: ReactNode;
  /** Gửi duyệt / Phát hành / Ghim của `useDiagramReview` — cùng nút với chế độ Xem. */
  reviewActions: ReactNode;
  dialogs: ReactNode;
  content: DiagramContent;
  settings: EditorSettings;
  /** `useStepUpRetry().run` của màn: lưu đòi mã sơ đồ, hết ân hạn giữa lúc vẽ thì hỏi tại chỗ. */
  run: <T>(action: () => Promise<T>, purpose: string) => Promise<T>;
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
  const [stockOpen, setStockOpen] = useState(false);
  const [inserting, setInserting] = useState(false);
  /*
   * Máy đã có trên bản vẽ: XML trình vẽ gửi gần nhất (`autosave`/`export` xml) cộng những máy vừa
   * chèn bằng `patch` — `patch` không làm draw.io gửi lại `autosave`, nên chỉ trông vào XML thì
   * chèn xong mở lại hộp vẫn mời chèn lần hai.
   */
  const [frameXml, setFrameXml] = useState(content.version?.xml ?? '');
  const [justInserted, setJustInserted] = useState<string[]>([]);
  const present = useMemo(() => new Set([...deviceIdsInXml(frameXml), ...justInserted]), [frameXml, justInserted]);
  const guard = useUnsavedGuard(dirty);
  /*
   * XML nạp lúc khung báo `init` và phiên bản gốc của lượt lưu kế tiếp. Lưu xong KHÔNG nạp lại
   * khung (xoá lịch sử hoàn tác của người vẽ) — chỉ dời mốc gốc sang phiên bản vừa tạo, để lượt
   * lưu sau của chính người này không bị ghi là "lưu đè".
   */
  const [palette] = useState(() => readCablePalette());
  // Nét dây của kho mang ô màu IMS (server hydrate); tô thành màu theo theme hiện tại trước khi nạp.
  const [initialXml] = useState(() => paintImsXml(content.version?.xml ?? '', palette));
  const basedOn = useRef<string | null>(content.version?.id ?? null);
  const pendingXml = useRef<string | null>(null);
  /*
   * Ai đang chờ tin `export` xml (cả tệp): chèn máy kho hay lượt lưu. draw.io trả lời theo đúng
   * thứ tự nhận lệnh, nên một hàng đợi đủ để ghép câu trả lời với người hỏi.
   *
   * Vì sao phải xin tệp riêng: với `pages=0` (AD-17), bản một trang thì tin `save`/`autosave` chỉ
   * mang mô hình trần `<mxGraphModel>` không có `<diagram id>` (server từ chối, `patch` không biết
   * trang), còn XML đi kèm `export` svg lại bị nén. Chỉ `export` xml trả cả tệp không nén.
   */
  const fileWaiters = useRef<((xml: string) => void)[]>([]);
  const withFile = (fn: (xml: string) => void) => {
    fileWaiters.current.push(fn);
    frame.current?.send({ action: 'export', format: 'xml' });
  };
  const [draftOpen, setDraftOpen] = useState(false);
  const frameState = useRef<{ page: number; bounds: Bounds | null }>({
    page: 0,
    bounds: null,
  });

  const setDirty = (value: boolean) => {
    setDirtyState(value);
    onDirtyChange(value);
  };

  const cables = useCableBridge({
    me,
    content,
    ready,
    withFile,
    send: (command) => frame.current?.send(command),
    page: () => frameState.current.page,
    markDirty: () => setDirty(true),
    palette,
    newId: newCellId,
  });

  // Nhịp "đang mở sửa" (Q-23): nửa thời gian giữ một lần, để một nhịp lỡ không làm tên biến mất.
  // Hết ân hạn sơ đồ thì nhịp nhận 401 và im lặng: không bật hộp nhập mã chỉ vì một nhịp nền.
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

  /*
   * Lưu đòi mã sơ đồ (Q-23: sửa bản vẽ có sẵn cũng hỏi mã). Hết ân hạn giữa lúc vẽ thì `run` mở
   * hộp nhập mã rồi chạy lại ĐÚNG lời gọi này — XML/SVG nằm trong closure, không phải xin trình
   * vẽ xuất lại, nên không mất nét nào. Đóng hộp = huỷ lượt lưu, bản vẽ vẫn còn trong khung.
   */
  const submit = async (xml: string, svg: string) => {
    const body = JSON.stringify({ xml, svg, basedOnVersionId: basedOn.current });
    try {
      const version = await run(
        () => apiFetch<VersionItem>(`/api/v1/diagrams/${diagramId}/versions`, { method: 'POST', csrfToken: me.csrfToken, body }),
        t('diagrams.screen.stepUpSave', { name: title }),
      );
      basedOn.current = version.id;
      setLastSaved(version);
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: TREE_KEY });
      void queryClient.invalidateQueries({ queryKey: nodeKey(diagramId) });
      void queryClient.invalidateQueries({ queryKey: versionsKey(diagramId) });
      void queryClient.invalidateQueries({ queryKey: historyKey(diagramId) });
      /*
       * Nội dung đã cache (Xem, và Sửa của chính màn này) đã cũ: đánh dấu để lần MỞ sau tải lại,
       * nhưng không tải ngay — tải ngay là nạp lại khung đang vẽ.
       */
      void queryClient.invalidateQueries({ queryKey: ['diagram-content', diagramId], refetchType: 'none' });
      toast({ tone: 'ok', message: t('diagrams.screen.saved', { seq: version.seq, summary: version.summary }) });
    } catch (error) {
      if (!isStepUpCancelled(error)) toast({ tone: 'error', message: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const insertInto = (xml: string, devices: DeviceCellSpec[]) => {
    const state = frameState.current;
    const pages = pageIds(xml);
    const pageId = pages[Math.min(state.page, pages.length - 1)];
    if (!pageId) {
      toast({ tone: 'error', message: t('diagrams.screen.insertFailed', { reason: 'page' }) });
      return;
    }
    const parent = layerIdOf(xml, pageId) ?? '1';
    const placed = placeCells(devices, { bounds: state.bounds, parent, previous: lastChildId(xml, pageId, parent), newId: newCellId });
    frame.current?.send({ action: 'patch', patch: insertPatch(pageId, placed.cells) });
    state.bounds = placed.bounds;
    setJustInserted((current) => [...current, ...devices.map((d) => d.id)]);
    setDirty(true);
    setStockOpen(false);
    // Máy vừa chèn có thể đã có dây trong sơ đồ cổng với máy đang trên bản vẽ → "Có N kết nối mới chưa vẽ".
    withFile((file) => cables.refreshUndrawn(file));
    toast({ tone: 'ok', message: t('diagrams.screen.inserted', { codes: devices.map((d) => d.code).join(', ') }) });
  };

  const onEvent = (message: DrawioEvent) => {
    const state = frameState.current;
    if (typeof message.currentPage === 'number') state.page = message.currentPage;
    if (message.modelBounds) state.bounds = message.modelBounds;
    switch (message.event) {
      /*
       * Sẵn sàng từ `init`: cầu nối gửi lệnh `load` NGAY khi nhận `init`, và draw.io xử lý tin
       * theo thứ tự, nên mọi lệnh sau (`export`, `save`) chạy trên bản đã nạp. Không bắt buộc
       * chờ tin `load` trả về: trên stack thật đã gặp nút Lưu tắt mãi vì tin đó không tới màn.
       */
      case 'init':
      case 'load':
        setReady(true);
        break;
      case 'autosave':
        setDirty(true);
        if (message.xml) {
          setFrameXml(message.xml);
          setJustInserted([]);
          cables.onAutosave(message.xml);
        }
        break;
      case 'patch':
        if (message.error) toast({ tone: 'error', message: t('diagrams.screen.insertFailed', { reason: message.error }) });
        break;
      case 'save':
        // Lưu = cả tệp XML + ảnh SVG để xem: xin tệp, rồi xin SVG, gửi cả hai khi SVG về.
        setSaving(true);
        withFile((xml) => {
          pendingXml.current = xml;
          frame.current?.send({ action: 'export', format: 'svg' });
        });
        break;
      case 'export': {
        if (message.format === 'xml') {
          fileWaiters.current.shift()?.(message.xml ?? '');
          break;
        }
        const xml = pendingXml.current;
        pendingXml.current = null;
        if (xml === null) break;
        const svg = exportedSvgText(message.data ?? '');
        if (!svg.value) {
          setSaving(false);
          toast({ tone: 'error', message: t('diagrams.screen.saveFailed') });
          break;
        }
        void submit(xml, svg.value);
        break;
      }
    }
  };

  /**
   * Ô chèn do server dựng (một lượt cho cả lô — hình theo loại, nhãn từ kho, cùng luật hydrate).
   * Máy đã thanh lý hay không còn trong kho bị bỏ ở đây lần nữa: danh sách trong hộp có thể đã cũ.
   */
  const insert = async (ids: string[]) => {
    setInserting(true);
    try {
      const infos = await apiFetch<DiagramDeviceInfo[]>(`/api/v1/diagrams/device-info?ids=${ids.map(encodeURIComponent).join(',')}`);
      const usable = infos.filter((info) => info.found && info.status !== 'retired' && info.code);
      if (usable.length === 0) {
        setInserting(false);
        toast({ tone: 'error', message: t('diagrams.screen.insertFailed', { reason: t('diagrams.stock.retired') }) });
        return;
      }
      const devices = usable.map((info) => ({ id: info.id, code: info.code ?? '', cell: info.cell }));
      // Hỏi draw.io cả tệp đang mở (có phần chưa lưu, có id trang) để biết trang và lớp đích.
      withFile((xml) => {
        if (xml) {
          setFrameXml(xml);
          insertInto(xml, devices);
        }
        setInserting(false);
      });
    } catch (error) {
      setInserting(false);
      toast({ tone: 'error', message: errorMessage(error) });
    }
  };

  const busy = saving;
  const status = (
    <>
      {others.length > 0 ? (
        <p className="badge warn" role="status">
          {t('diagrams.screen.presence', { names: others.map((o) => o.fullName).join(', ') })}
        </p>
      ) : null}
      {cables.status}
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
          <Popover label={t('diagrams.stock.button')} title={t('diagrams.stock.title')} open={stockOpen} onOpenChange={setStockOpen} disabled={!ready}>
            <StockDevicePicker present={present} busy={inserting} onInsert={(ids) => void insert(ids)} />
          </Popover>
          {cables.actions}
          <button type="button" className="btn" disabled={!ready} onClick={() => setDraftOpen(true)}>
            {t('diagrams.cable.draftButton')}
          </button>
          <button type="button" className="btn primary" disabled={!ready || busy} onClick={() => frame.current?.send({ action: 'save' })}>
            {busy ? t('diagrams.screen.saving') : t('diagrams.screen.save')}
          </button>
          {reviewActions}
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
          {cables.dialogs}
          {draftOpen ? (
            <DraftFromPortMapDialog
              diagramId={diagramId}
              title={title}
              dirty={dirty}
              csrfToken={me.csrfToken}
              run={run}
              onClose={() => setDraftOpen(false)}
              onDone={(version) => {
                setDraftOpen(false);
                setDirty(false);
                toast({ tone: 'ok', message: t('diagrams.cable.draftDone', { seq: version.seq }) });
                void queryClient.invalidateQueries({ queryKey: versionsKey(diagramId) });
                void queryClient.invalidateQueries({ queryKey: TREE_KEY });
                // Nạp phiên bản nháp vừa dựng vào khung (lượt vẽ dở, nếu có, người dùng đã đồng ý bỏ).
                void queryClient.invalidateQueries({ queryKey: ['diagram-content', diagramId] });
              }}
            />
          ) : null}
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

/**
 * Ô thiết bị của phiên bản → ô bấm được của trình xem + dữ liệu thẻ. Máy không còn trong kho:
 * dấu đỏ "Không tìm thấy trong kho" (không lỗi trang); máy đã thanh lý: dấu vàng.
 */
function viewerCells(
  content: DiagramContent,
  t: (key: string) => string,
): {
  cells: ViewerCell[];
  byCell: Map<string, { device: DiagramDeviceInfo | null; code: string }>;
  byEdge: Map<string, { edge: CableEdge; link: DiagramLink | null }>;
} {
  const devices = new Map((content.devices ?? []).map((d) => [d.id, d]));
  const cells: ViewerCell[] = [];
  const byCell = new Map<string, { device: DiagramDeviceInfo | null; code: string }>();
  for (const { cellId, deviceId, code } of content.deviceCells ?? []) {
    const device = devices.get(deviceId) ?? null;
    const label = device?.found ? (device.code ?? code) : code;
    if (!device?.found) cells.push({ id: cellId, label: `${label} — ${t('diagrams.screen.deviceMissing')}`, mark: 'danger' });
    else if (device.status === 'retired') cells.push({ id: cellId, label: `${label} — ${t('diagrams.screen.deviceRetired')}`, mark: 'warn' });
    else cells.push({ id: cellId, label });
    byCell.set(cellId, { device, code });
  }
  /*
   * Nét dây của kho: tô lại theo ô màu loại dây HIỆN TẠI (không tin màu chụp trong SVG); nét chưa
   * khai vàng, nét có kết nối đã gỡ đỏ (AD-18). Bấm nét mở thẻ dây.
   */
  const links = new Map((content.links ?? []).map((l) => [l.id, l]));
  const byEdge = new Map<string, { edge: CableEdge; link: DiagramLink | null }>();
  for (const edge of content.cableEdges ?? []) {
    const link = edge.linkId ? (links.get(edge.linkId) ?? null) : null;
    byEdge.set(edge.cellId, { edge, link });
    if (edge.state === 'linked' && link) {
      const label = edge.sourceDeviceId === link.peerDeviceId ? link.labelFromB : link.labelFromA;
      cells.push({ id: edge.cellId, label, paint: `cable-${link.colorSlot ?? 0}` });
    } else if (edge.state === 'undeclared') {
      cells.push({ id: edge.cellId, label: t('diagrams.cable.cardUndeclared'), paint: 'warn', mark: 'warn' });
    } else {
      cells.push({ id: edge.cellId, label: t('diagrams.cable.cardRemoved'), paint: 'danger', mark: 'danger' });
    }
  }
  return { cells, byCell, byEdge };
}

/** Ô sáng khi bấm một máy: ô của máy, mọi nét dây chạm nó, ô của máy đầu kia (AD-18). */
function focusCells(content: DiagramContent, deviceId: string): string[] | null {
  const deviceCells = content.deviceCells ?? [];
  const own = deviceCells.filter((c) => c.deviceId === deviceId).map((c) => c.cellId);
  if (own.length === 0) return null;
  const edges = (content.cableEdges ?? []).filter((e) => e.sourceDeviceId === deviceId || e.targetDeviceId === deviceId);
  const far = new Set(edges.map((e) => (e.sourceDeviceId === deviceId ? e.targetDeviceId : e.sourceDeviceId)));
  const farCells = deviceCells.filter((c) => far.has(c.deviceId)).map((c) => c.cellId);
  return [...own, ...edges.map((e) => e.cellId), ...farCells];
}
