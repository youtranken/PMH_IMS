import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { BREAKPOINTS } from '@/ui/breakpoints';
import { useConfirm } from '@/ui/confirm-provider';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { diagramVersionLabel, diagramVersionStanding } from '@/ui/diagram-version';
import { DiagramViewer, type ViewerCell, type ViewerDiff } from '@/ui/diagram-viewer';
import { DrawioFrame, readCablePalette, type DrawioFrameHandle } from '@/ui/drawio-frame';
import { exportedSvgText, paintImsXml, type DrawioEvent } from '@/ui/drawio-protocol';
import { InfoTip } from '@/ui/info-tip';
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
  compareKey,
  contentKey,
  historyKey,
  nodeKey,
  versionsKey,
  type CompareView,
  type DiagramContent,
  type CableEdge,
  type DiagramDeviceInfo,
  type DiagramFrame,
  type DiagramLink,
  type DiagramNode,
  type EditorSettings,
  type PathResult,
  type VersionItem,
} from './diagram-api';
import { CableLegend } from './cable-legend';
import { DeviceConnections, DiagramCableCard } from './diagram-cable-card';
import { DiagramBreadcrumb } from './diagram-breadcrumb';
import { DiagramDeviceCard } from './diagram-device-card';
import { placeFreeCells, type FreeCellSpec } from './diagram-presentation';
import { canCreatePresentation, CreatePresentationDialog, PresentationBand, usePresentationTools } from './diagram-presentation-tools';
import { BarAnchorProvider, BarButton, BarMenu, type BarAction } from './diagram-bar';
import { DiagramGuideDialog, EditStartCard } from './diagram-guide';
import { DiagramSubnetCard } from './diagram-subnet-card';
import { DriftCheckDialog, withDriftMarks } from './diagram-drift';
import { PinModeToggle, useDiagramReview } from './diagram-review';
import { buildLayers, pathOnDrawing } from './diagram-navigation';
import { DiagramPathTool } from './diagram-path-tool';
import { DiagramSearch } from './diagram-search';
import type { PublicationEvent } from './diagram-timeline';
import { ExportMenu, TimelineMenu } from './diagram-tools';
import { DiagramVersionsDialog } from './diagram-versions-dialog';
import {
  deviceIdsInXml,
  growBounds,
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
import { useFrameBridge } from './use-frame-bridge';
import { usePhotoBridge } from './use-photo-bridge';
import { useRackFit } from './use-rack-fit';

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
  /*
   * Màn hẹp (điện thoại, máy tính bảng dọc) chỉ XEM (Q-23): đường dẫn sửa mở thành chế độ xem kèm
   * lời nhắn — không nạp draw.io, không có công cụ sửa / gửi duyệt.
   */
  const narrow = useMediaQuery(BREAKPOINTS.editor);
  const node = useQuery({ queryKey: nodeKey(id), queryFn: () => apiFetch<DiagramNode>(`/api/v1/diagrams/${id}`) });
  // Bản đã lưu trữ chỉ xem (Q-23): server cũng chặn mọi lượt ghi, không mở trình vẽ cho một đường cụt.
  const shelved = Boolean(node.data?.archivedAt);
  const editRequested = params.get('mode') === 'edit';
  const mode: Mode = editRequested && !narrow && !shelved ? 'edit' : 'view';
  const versionId = mode === 'view' ? params.get('version') : null;
  /* `?compare=<phiên bản trước>` = so sánh tô màu với bản đang xem; `?at=YYYY-MM-DD` = bản chính
     thức hiệu lực ngày đó (thanh trượt thời gian) — không kèm `version` nghĩa là ngày đó chưa có. */
  const compareFrom = mode === 'view' ? params.get('compare') : null;
  const atDay = mode === 'view' ? params.get('at') : null;
  const noOfficialAt = Boolean(atDay) && !versionId;
  const ask = useConfirm();
  const queryClient = useQueryClient();
  const stepUp = useStepUpRetry(me.csrfToken);
  const [dirty, setDirty] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [cardCellId, setCardCellId] = useState<string | null>(null);
  const [subnetFrame, setSubnetFrame] = useState<(DiagramFrame & { subnetId: string }) | null>(null);
  const navigate = useNavigate();
  const toast = useToast();
  const [driftOpen, setDriftOpen] = useState(false);
  /*
   * Tô sáng ở chế độ xem: máy đang được "bấm" (dây của nó + máy đầu kia sáng). Mở từ mũi tên "→ máy
   * (bản vẽ khác)" thì `?focus=<id máy>` chọn sẵn máy đó và bay tới.
   */
  const [focusDeviceId, setFocusDeviceId] = useState<string | null>(() => params.get('focus'));
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [presentationOpen, setPresentationOpen] = useState(false);
  /* "Chỉ đường": kết quả server (sơ đồ cổng); có đường thì tô sáng đè lên tô sáng của máy đang chọn. */
  const [path, setPath] = useState<PathResult | null>(null);
  /* Bay tới từ ô tìm (hay từ bản vẽ khác qua `?focus=`): phóng tới mức đọc được, không chỉ dời khung. */
  const [flyClose, setFlyClose] = useState(() => Boolean(params.get('focus')));
  const [pathOpen, setPathOpen] = useState(false);

  const settings = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => apiFetch<EditorSettings>('/api/v1/diagrams/editor-settings'),
    staleTime: 60_000,
  });
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
    enabled: node.isSuccess && !compareFrom && !noOfficialAt,
    // Mỗi lần tải nội dung là một dòng `diagram.viewed`: không tự tải lại khi quay lại tab trình duyệt.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  const compareTo = compareFrom ? (versionId ?? node.data?.latestVersion?.id ?? null) : null;
  const compare = useQuery({
    queryKey: compareKey(id, compareFrom ?? '', compareTo ?? ''),
    queryFn: () =>
      stepUp.run(
        () => apiFetch<CompareView>(`/api/v1/diagrams/${id}/compare?${new URLSearchParams({ from: compareFrom ?? '', to: compareTo ?? '' }).toString()}`),
        t('diagrams.screen.stepUpPurpose', { name: node.data?.name ?? '' }),
      ),
    enabled: node.isSuccess && Boolean(compareFrom && compareTo),
    // Cùng lý do với nội dung: mỗi lần tải là một dòng `diagram.viewed`.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const diff = useMemo<ViewerDiff | null>(
    () =>
      compare.data
        ? {
            added: compare.data.result.added.map((c) => c.id),
            changed: compare.data.result.changed.map((c) => c.id),
            removed: compare.data.result.removed,
            anchors: compare.data.result.anchors,
          }
        : null,
    [compare.data],
  );

  /** Sang một trạng thái xem khác (phiên bản, so sánh); đang vẽ dở thì hỏi trước. */
  const goView = async (next: Record<string, string>) => {
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
    setParams(next);
  };

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
  /* Kéo thanh trượt: thay chứ không chồng lịch sử trình duyệt — mỗi nấc kéo không thành một bước "Back". */
  const pickDay = (day: string, official: PublicationEvent | null) =>
    setParams(official ? { version: official.versionId, at: day } : { at: day }, { replace: true });

  const review = useDiagramReview({
    me,
    diagram: node.data ?? null,
    run: stepUp.run,
    versionId: content.data?.version?.id ?? null,
    dirty,
    onGoToCell: goToCell,
    onCompare: (from, to) => void goView({ version: to, compare: from }),
    cells: content.data?.cells,
  });

  /*
   * Lưu xong mời bước kế tiếp ngay trên lời báo (E-06): Admin/SA "Phát hành #n", Thành viên
   * "Gửi duyệt #n" (nháp của chính mình — vừa lưu). Bản trình bày không qua duyệt; đang có yêu cầu
   * chờ thì không mời gửi thêm.
   */
  const manager = me.role === 'sa' || me.role === 'admin';
  const nextStep =
    node.data && node.data.kind === 'official' && !shelved && !node.data.pendingApprovalId
      ? (saved: VersionItem) => ({
          label: t(manager ? 'diagrams.panel.publish' : 'diagrams.panel.submit', { seq: saved.seq }),
          onClick: () => (manager ? review.next.publish : review.next.submit)({ versionId: saved.id, seq: saved.seq }),
        })
      : null;

  const tabs = narrow || shelved ? null : (
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
  const versionsAction: BarAction = {
    key: 'versions',
    label: t('diagrams.screen.versions'),
    disabled: !content.isSuccess,
    onSelect: () => setVersionsOpen(true),
  };
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
            void goView({ version: version.id });
          }}
          onCompare={(from, to) => {
            setVersionsOpen(false);
            void goView({ version: to.id, compare: from.id });
          }}
          onClose={() => setVersionsOpen(false)}
        />
      ) : null}
    </>
  );

  let body: ReactNode;
  /*
   * Bản trình bày không qua duyệt (Q-23): không Gửi duyệt / Phát hành / ghim — server cũng từ chối
   * (`DIAGRAM_NOT_REVIEWABLE`), ẩn nút để không ai bấm vào một đường cụt.
   */
  const reviewable = node.data ? node.data.kind !== 'presentation' : false;
  /* Màn hẹp chỉ xem (Q-23): không Gửi duyệt / Phát hành / Duyệt / ghim — thẻ trạng thái duyệt vẫn hiện. */
  const reviewActs = reviewable && !narrow && !shelved;
  const reviewPrimary = reviewActs ? review.primary : [];
  const reviewMenu = reviewActs ? review.menu : [];
  /*
   * Thanh nút dựng MỘT lần ở cuối với cùng thứ tự con ở mọi trạng thái tải: bọc thêm một lớp khi
   * nội dung về là dựng lại các nút, mất trạng thái của nút đang mở hộp.
   */
  let viewMenu: BarAction[] = [];
  let exportVersionId: string | null = null;
  let searchTool: ReactNode = null;
  let pathTool: ReactNode = null;
  /* So sánh chỉ còn nút Phiên bản; ngày chưa có bản chính thức chỉ còn thanh trượt để kéo đi ngày khác. */
  let toolbar: 'full' | 'compare' | 'timeline' = 'full';
  let status: ReactNode = (
    <>
      {reviewable ? review.badge : null}
      {editRequested && narrow ? (
        <p className="muted" role="status">
          {t('diagrams.screen.desktopOnly')}
        </p>
      ) : null}
      {review.status}
    </>
  );
  const band = node.data ? (
    <>
      {shelved ? (
        <div className="alert warn full-band" role="note" aria-label={t('diagrams.archivedList.bandLabel')}>
          {t('diagrams.archivedList.band')}
        </div>
      ) : null}
      <PresentationBand diagram={node.data} />
    </>
  ) : null;
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
  } else if (compareFrom) {
    toolbar = 'compare';
    status = (
      <p className="muted" role="status">
        {compare.data ? t('diagrams.screen.compareStatus', { from: compare.data.from.seq, to: compare.data.to.seq }) : null}{' '}
        <button type="button" className="btn sm" onClick={() => setParams(compareTo ? { version: compareTo } : {})}>
          {t('diagrams.screen.compareExit')}
        </button>
      </p>
    );
    if (compare.isPending) body = <Loading />;
    else if (compare.isError) body = <LoadError error={compare.error} onRetry={() => void compare.refetch()} />;
    else if (!compare.data.to.svg) body = <EmptyState title={t('diagrams.screen.compareNoImage')} />;
    else body = <DiagramViewer svg={compare.data.to.svg} viewer={me} title={t('diagrams.screen.compareTitle')} diff={diff} />;
  } else if (noOfficialAt && node.data) {
    toolbar = 'timeline';
    body = (
      <EmptyState
        title={t('diagrams.tools.timelineNone')}
        action={
          <button type="button" className="btn primary" onClick={() => setParams({})}>
            {t('diagrams.screen.backToLatest')}
          </button>
        }
      />
    );
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
        versionsAction={versionsAction}
        reviewMenu={[...reviewPrimary, ...reviewMenu]}
        reviewPopovers={reviewable ? review.popovers : null}
        reviewStatus={status}
        nextStep={nextStep}
        dialogs={dialogs}
        band={band}
        content={content.data}
        settings={settings.data}
        run={stepUp.run}
        onDirtyChange={setDirty}
      />
    );
  } else if (!content.data.version?.svg) {
    // Phiên bản dựng tự động (dựng lại mặt tủ / dựng nháp) có nội dung nhưng chưa có ảnh xem.
    const seq = content.data.version?.seq;
    body = seq ? (
      <EmptyState title={t('diagrams.screen.noPreviewTitle', { seq })} hint={t('diagrams.screen.noPreviewHint')} />
    ) : (
      <EmptyState title={t('diagrams.screen.noVersionTitle')} hint={t('diagrams.screen.noVersionHint')} />
    );
  } else {
    const version = content.data.version;
    /*
     * Luôn nói đang xem bản nào (V-01): người được gửi link tin mình đang thấy sơ đồ chính thức, nên
     * một bản nháp chưa duyệt phải tự xưng là nháp. Bản trình bày không có bản chính thức để so.
     */
    const officialSeq = content.data.diagram.officialSeq ?? null;
    const officialId = content.data.diagram.officialVersionId ?? null;
    if (content.data.diagram.kind !== 'presentation') {
      const standing = diagramVersionStanding(version.seq, officialSeq);
      const label = diagramVersionLabel(t, version.seq, officialSeq);
      status = (
        <>
          <span className={standing === 'official' ? 'badge ok' : 'badge warn'} role="status">
            {standing === 'official' ? label : t(standing === 'draft' ? 'diagrams.screen.viewingDraft' : 'diagrams.screen.viewingOlder', { version: label })}
          </span>
          {standing !== 'official' && officialId && officialSeq ? (
            <button type="button" className="btn sm" onClick={() => setParams({ version: officialId })}>
              {t('diagrams.screen.viewOfficial', { version: diagramVersionLabel(t, officialSeq, officialSeq, 'short') })}
            </button>
          ) : null}
          {status}
        </>
      );
    }
    const view = viewerCells(content.data, t);
    // Lệch kho (Q-23): chỉ báo — dấu trên ô, lời báo trên thanh, hộp liệt kê; không nút nào sửa.
    const drift = content.data.drift ?? [];
    const card = cardCellId ? view.byCell.get(cardCellId) : undefined;
    const data = content.data;
    const route = path ? pathOnDrawing(data, path, id) : null;
    const lit = route && route.cellIds.length > 0 ? route.cellIds : null;
    const layers = buildLayers(data, {
      baseLayer: t('diagrams.nav.baseLayer'),
      noDeviceType: t('diagrams.nav.noDeviceType'),
      noCableType: t('diagrams.nav.noCableType'),
    });
    const cellBounds = (data.cells ?? []).flatMap((cell) => (cell.bounds ? [{ id: cell.id, bounds: cell.bounds }] : []));
    const selectedCode = focusDeviceId ? ((data.deviceCells ?? []).find((c) => c.deviceId === focusDeviceId)?.code ?? '') : '';
    searchTool = (
      <DiagramSearch
        content={data}
        diagramId={id}
        onFly={(match) => {
          setPath(null);
          setCardCellId(null);
          setFocusDeviceId(match.deviceId);
          setFlyClose(true);
          goToCell(match.cellId);
        }}
      />
    );
    pathTool = pathOpen ? (
      <DiagramPathTool
        initialFrom={focusDeviceId ? { deviceId: focusDeviceId, term: selectedCode } : null}
        onResult={(result) => setPath(result.path ? result : null)}
        onClose={() => setPathOpen(false)}
      />
    ) : null;
    exportVersionId = version.id;
    viewMenu = [
      { key: 'path', label: t('diagrams.nav.path'), onSelect: () => setPathOpen(true) },
      ...(reviewActs && !review.pinMode ? [{ key: 'pin-mode', label: t('diagrams.review.pinMode'), onSelect: review.togglePinMode }] : []),
      { key: 'drift', label: t('diagrams.drift.check'), onSelect: () => setDriftOpen(true) },
      { key: 'export', label: t('diagrams.tools.export'), onSelect: () => setExportOpen(true) },
    ];
    const edgeCard = cardCellId ? view.byEdge.get(cardCellId) : undefined;
    /*
     * Khung bản vẽ con: bấm (hay nháy đúp) là xuống bản vẽ con — trong ân hạn mã sơ đồ thì không hỏi
     * lại. Bản vẽ con đã lưu trữ / không còn: chỉ báo, không mở trang lỗi. Khung VLAN: thẻ dải IP.
     */
    const openFrame = (frame: DiagramFrame) => {
      if (frame.childDiagramId) {
        if (frame.child && !frame.child.archived) navigate(PATHS.diagram(frame.child.id));
        else if (frame.child) toast({ tone: 'warn', message: t('diagrams.frames.childArchivedToast', { name: frame.child.name }) });
        else toast({ tone: 'warn', message: t('diagrams.frames.childMissingToast') });
        return;
      }
      if (frame.subnetId) setSubnetFrame({ ...frame, subnetId: frame.subnetId });
    };
    const focus = focusDeviceId ? focusCells(content.data, focusDeviceId) : null;
    const focusCode = focusDeviceId ? ((content.data.deviceCells ?? []).find((c) => c.deviceId === focusDeviceId)?.code ?? '') : '';
    body = (
      <>
        <DiagramViewer
          svg={version.svg ?? ''}
          viewer={me}
          title={t('diagrams.screen.viewerTitle')}
          cells={withDriftMarks(view.cells, drift)}
          selectedCellId={cardCellId ?? focusCell}
          onCellClick={
            review.pinMode
              ? review.viewer.onPickCell
              : (cellId) => {
                  const frame = view.byFrame.get(cellId);
                  if (frame) {
                    openFrame(frame);
                    return;
                  }
                  setCardCellId(cellId);
                  const deviceId = view.byCell.get(cellId)?.device?.id ?? (content.data.deviceCells ?? []).find((c) => c.cellId === cellId)?.deviceId;
                  if (deviceId) setFocusDeviceId(deviceId);
                }
          }
          pickAnyCell={review.viewer.pickAnyCell}
          pins={review.viewer.pins}
          onPinClick={review.viewer.onPinClick}
          focusCellId={focusCell ?? (focus && params.get('focus') ? focus[0] : null)}
          focusScale={flyClose ? 1 : undefined}
          highlightCellIds={lit ?? focus}
          layers={layers}
          cellBounds={cellBounds}
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
        {subnetFrame ? <DiagramSubnetCard frame={subnetFrame} onClose={() => setSubnetFrame(null)} /> : null}
        {edgeCard ? (
          <DiagramCableCard edge={edgeCard.edge} link={edgeCard.link} cableTypes={content.data.cableTypes ?? []} onClose={() => setCardCellId(null)} />
        ) : null}
        {driftOpen ? <DriftCheckDialog drift={drift} onGoTo={goToCell} onClose={() => setDriftOpen(false)} /> : null}
      </>
    );
    if (drift.length > 0) {
      status = (
        <>
          {status}
          <button type="button" className="btn sm" onClick={() => setDriftOpen(true)}>
            {/* Chỉ có kết nối mới chưa vẽ: CÙNG câu với tab Sửa (V-09), kèm lối đi tiếp. */}
            {drift.every((f) => f.code === 'DRIFT_UNDRAWN_LINK')
              ? `${t('diagrams.cable.undrawn', { n: drift.length })}${t('diagrams.drift.drawInEdit')}`
              : t('diagrams.drift.changes', { count: drift.length })}
          </button>
        </>
      );
    }
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
    if (path?.path) {
      const elsewhere = route?.elsewhere ?? [];
      status = (
        <>
          {status}
          <p className="muted" role="status">
            {t('diagrams.nav.pathFound', { from: path.from.code, to: path.to.code, count: path.path.linkIds.length })}{' '}
            {elsewhere.map((hop) =>
              hop.diagrams[0] ? (
                <Link
                  key={hop.deviceId}
                  className="linkbtn sm"
                  to={`${PATHS.diagram(hop.diagrams[0].id)}?${new URLSearchParams({ focus: hop.deviceId }).toString()}`}
                >
                  {t('diagrams.nav.pathJump', { code: hop.code, diagram: hop.diagrams[0].name })}
                </Link>
              ) : (
                <span key={hop.deviceId} className="badge outline">
                  {t('diagrams.nav.pathOffDrawing', { code: hop.code })}
                </span>
              ),
            )}{' '}
            <button type="button" className="btn sm" onClick={() => setPath(null)}>
              {t('diagrams.nav.pathClear')}
            </button>
          </p>
        </>
      );
    } else if (focusDeviceId && focus) {
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
            {atDay
              ? t('diagrams.tools.timelineHit', { date: formatDate(atDay), seq: version.seq })
              : t('diagrams.screen.viewingOld', { seq: version.seq, at: formatDateTime(version.savedAt) })}{' '}
            <button type="button" className="btn sm" onClick={() => setParams({})}>
              {t('diagrams.screen.backToLatest')}
            </button>
          </p>
        </>
      );
    }
  }

  /*
   * Thanh mảnh (Q-23 một thanh, Q-18 việc chính để ngoài): chế độ Xem để ngoài nút "Tìm" (trên
   * điện thoại đó là cách duy nhất tới một máy trong bản vẽ lớn), việc duyệt theo trạng thái (Phát
   * hành / Gửi duyệt / Duyệt…) và nút "Đang ghim" khi đang bật; mọi việc khác — kể cả "Chỉ đường" —
   * vào menu ⋮. Thanh dựng MỘT lần ở cuối với cùng thứ tự ở mọi trạng thái tải: hộp nổi của menu giữ
   * trạng thái mở ở màn, không bị dựng lại mất giữa chừng.
   */
  const inView = mode === 'view' && toolbar === 'full';
  const timelineMenu =
    node.data && toolbar !== 'compare' && mode === 'view' && (toolbar === 'timeline' || content.isSuccess) ? (
      <TimelineMenu
        diagram={node.data}
        run={stepUp.run}
        day={atDay}
        onPick={pickDay}
        open={timelineOpen}
        onOpenChange={setTimelineOpen}
        inMenu={toolbar === 'full'}
      />
    ) : null;
  const primary = (
    <>
      {inView ? searchTool : null}
      {inView && searchTool ? <InfoTip subject={t('diagrams.nav.search')}>{t('diagrams.help.search')}</InfoTip> : null}
      {inView && reviewActs && review.pinMode ? <PinModeToggle active onToggle={review.togglePinMode} /> : null}
      {inView ? reviewPrimary.map((action) => <BarButton key={action.key} action={action} />) : null}
      {toolbar === 'timeline' ? timelineMenu : null}
      {toolbar === 'compare' && !narrow ? <BarButton action={versionsAction} /> : null}
    </>
  );
  const menu: BarAction[] = inView
    ? [
        ...reviewMenu,
        ...viewMenu,
        ...(timelineMenu ? [{ key: 'timeline', label: t('diagrams.tools.timeline'), onSelect: () => setTimelineOpen(true) }] : []),
        ...(narrow ? [] : [versionsAction]),
        ...(!narrow && !shelved && canCreatePresentation(node.data)
          ? [{ key: 'presentation', label: t('diagrams.presentation.create'), onSelect: () => setPresentationOpen(true) }]
          : []),
      ]
    : [];
  const popovers = (
    <>
      {inView && reviewActs ? review.popovers : null}
      {inView ? pathTool : null}
      {toolbar === 'full' ? timelineMenu : null}
      {node.data && exportVersionId ? (
        <ExportMenu me={me} diagram={node.data} versionId={exportVersionId} run={stepUp.run} open={exportOpen} onOpenChange={setExportOpen} />
      ) : null}
      {presentationOpen && node.data ? (
        <CreatePresentationDialog me={me} diagram={node.data} run={stepUp.run} onClose={() => setPresentationOpen(false)} />
      ) : null}
    </>
  );
  return (
    <ScreenFrame
      diagramId={id}
      title={title}
      tabs={tabs}
      primary={primary}
      menu={menu}
      popovers={popovers}
      status={status}
      band={band}
      body={body}
      dialogs={dialogs}
    />
  );
}

/**
 * Thanh mảnh + vùng trình vẽ/trình xem. Không cột panel (Q-23). Thanh là MỘT dòng trên màn laptop:
 * đường dẫn, tên, tab, việc chính, menu ⋮ rồi các lời báo gọn; dòng không đủ chỗ thì đường dẫn và
 * lời báo co lại (cắt "…") chứ không đẩy thanh xuống hai dòng che trình vẽ.
 */
function ScreenFrame({
  diagramId,
  title,
  tabs,
  primary,
  menu = [],
  popovers,
  status,
  band,
  body,
  dialogs,
}: {
  diagramId: string;
  title: string;
  tabs: ReactNode;
  /** Việc chính đứng ngoài thanh. */
  primary?: ReactNode;
  /** Việc còn lại — menu ⋮ (Q-18). */
  menu?: BarAction[];
  /** Hộp nổi mở từ mục menu — neo vào nút ⋮. */
  popovers?: ReactNode;
  status?: ReactNode;
  /** Dải ngay dưới thanh trên (bản trình bày) — nằm ngoài trình vẽ/trình xem nên luôn thấy. */
  band?: ReactNode;
  body: ReactNode;
  dialogs?: ReactNode;
}) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  // "Hướng dẫn" ĐẦU menu, ở mọi chế độ (Q-23): menu của màn sửa dài, để cuối là phải cuộn mới thấy.
  const items: BarAction[] = [{ key: 'guide', label: t('diagrams.guide.menu'), onSelect: () => setGuideOpen(true) }, ...menu];
  return (
    <>
      <div className="full-bar">
        <DiagramBreadcrumb diagramId={diagramId} />
        <h1 className="full-bar-title">{title}</h1>
        {tabs}
        <BarAnchorProvider value={anchor}>
          <div className="full-bar-actions">
            {primary}
            <span ref={setAnchor} className="full-bar-more">
              <BarMenu label={t('diagrams.actionsOf', { name: title })} subject={title} items={items} />
            </span>
            {popovers}
          </div>
        </BarAnchorProvider>
        {status ? <div className="full-bar-status">{status}</div> : null}
      </div>
      {band}
      <div className="full-stage">{body}</div>
      {dialogs}
      {guideOpen ? <DiagramGuideDialog onClose={() => setGuideOpen(false)} /> : null}
    </>
  );
}

function DiagramEditor({
  me,
  diagramId,
  title,
  tabs,
  versionsAction,
  reviewMenu,
  reviewPopovers,
  reviewStatus,
  nextStep,
  dialogs,
  band,
  content,
  settings,
  run,
  onDirtyChange,
}: {
  me: Me;
  diagramId: string;
  title: string;
  tabs: ReactNode;
  versionsAction: BarAction;
  /**
   * Gửi duyệt / Phát hành / Duyệt… / Ghim của `useDiagramReview` — cùng việc với chế độ Xem, nhưng
   * ở đây vào menu ⋮: việc chính của màn sửa là Thiết bị kho và Lưu.
   */
  reviewMenu: BarAction[];
  reviewPopovers: ReactNode;
  /** Thẻ "Chờ duyệt" / lỗi tải trang duyệt cho vùng trạng thái. */
  reviewStatus: ReactNode;
  /** Nút bước kế tiếp gắn vào lời báo lưu xong (E-06); `null` = không mời gì. */
  nextStep: ((saved: VersionItem) => { label: string; onClick: () => void }) | null;
  dialogs: ReactNode;
  band: ReactNode;
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
  const [startDismissed, setStartDismissed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<VersionItem | null>(content.version);
  /*
   * Phiên bản dựng tự động (dựng lại mặt tủ, dựng nháp) chưa có ảnh xem: Lưu bật ngay dù chưa sửa gì
   * — lưu chính là cách tạo ảnh xem cho tab Xem (server cũng nhận đó là một phiên bản).
   */
  const [needsPreview, setNeedsPreview] = useState(Boolean(content.version && !content.version.svg));
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

  const frames = useFrameBridge({
    diagramId,
    ready,
    xml: frameXml,
    withFile,
    send: (command) => frame.current?.send(command),
    page: () => frameState.current.page,
    bounds: {
      get: () => frameState.current.bounds,
      grow: (rect) => {
        frameState.current.bounds = growBounds(frameState.current.bounds, rect);
      },
    },
    markDirty: () => setDirty(true),
    newId: newCellId,
    onInserted: (deviceIds) => {
      setJustInserted((current) => [...current, ...deviceIds]);
      withFile((file) => cables.refreshUndrawn(file));
    },
  });

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

  const racks = useRackFit({
    devices: content.devices ?? [],
    initialXml: content.version?.xml ?? '',
    csrfToken: me.csrfToken,
    ready,
    withFile,
    send: (command) => frame.current?.send(command),
    page: () => frameState.current.page,
    markDirty: () => setDirty(true),
  });

  const photos = usePhotoBridge({
    ready,
    withFile,
    send: (command) => frame.current?.send(command),
    page: () => frameState.current.page,
    markDirty: () => setDirty(true),
  });

  /*
   * "Dựng lại mặt tủ" (bản vẽ loại tủ): server dựng một phiên bản nháp MỚI từ kho rồi nạp lại khung —
   * lượt vẽ dở chưa lưu sẽ mất, nên hỏi trước bằng hộp dùng chung. Phiên bản cũ còn nguyên để khôi phục.
   */
  const ask = useConfirm();
  const [rebuilding, setRebuilding] = useState(false);
  const rebuildRack = async () => {
    const ok = await ask({
      title: t('diagrams.rack.rebuildTitle'),
      message: dirty ? `${t('diagrams.rack.rebuildMessage')} ${t('diagrams.screen.leaveMessage')}` : t('diagrams.rack.rebuildMessage'),
      confirmLabel: t('diagrams.rack.rebuildConfirm'),
    });
    if (!ok) return;
    setRebuilding(true);
    try {
      const version = await run(
        () => apiFetch<VersionItem>(`/api/v1/diagrams/${diagramId}/versions/rebuild-rack`, { method: 'POST', csrfToken: me.csrfToken }),
        t('diagrams.rack.rebuildStepUp', { name: title }),
      );
      // Kho không đổi gì từ lần dựng trước: server không tạo phiên bản, khung đang vẽ giữ nguyên.
      if (version.unchanged) {
        toast({ tone: 'warn', message: t('diagrams.rack.rebuildSame') });
        return;
      }
      setDirty(false);
      toast({ tone: 'ok', message: t('diagrams.rack.rebuildDone', { seq: version.seq }) });
      void queryClient.invalidateQueries({ queryKey: versionsKey(diagramId) });
      void queryClient.invalidateQueries({ queryKey: TREE_KEY });
      void queryClient.invalidateQueries({ queryKey: ['diagram-content', diagramId] });
    } catch (error) {
      if (!isStepUpCancelled(error)) toast({ tone: 'error', message: errorMessage(error) });
    } finally {
      setRebuilding(false);
    }
  };
  const isRack = content.diagram.nodeType === 'cabinet' && Boolean(content.diagram.cabinetId);

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
      setDirty(false);
      setNeedsPreview(false);
      // Bản mới nhất có thể là của người khác lưu trùng nội dung: dòng "Đã lưu #n" theo đúng bản đó.
      setLastSaved(version);
      // Trùng y nguyên bản mới nhất: server không tạo phiên bản nào (Q-23) — không có gì mới để báo.
      if (version.unchanged) {
        toast({ tone: 'warn', message: t('diagrams.screen.nothingToSave') });
        return;
      }
      void queryClient.invalidateQueries({ queryKey: TREE_KEY });
      void queryClient.invalidateQueries({ queryKey: nodeKey(diagramId) });
      void queryClient.invalidateQueries({ queryKey: versionsKey(diagramId) });
      void queryClient.invalidateQueries({ queryKey: historyKey(diagramId) });
      /*
       * Nội dung đã cache (Xem, và Sửa của chính màn này) đã cũ: đánh dấu để lần MỞ sau tải lại,
       * nhưng không tải ngay — tải ngay là nạp lại khung đang vẽ.
       */
      void queryClient.invalidateQueries({ queryKey: ['diagram-content', diagramId], refetchType: 'none' });
      toast({ tone: 'ok', message: t('diagrams.screen.saved', { seq: version.seq, summary: version.summary }), action: nextStep?.(version) });
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

  const insertFreeInto = (xml: string, free: { specs: FreeCellSpec[]; message: string }) => {
    const state = frameState.current;
    const pages = pageIds(xml);
    const pageId = pages[Math.min(state.page, pages.length - 1)];
    if (!pageId) {
      toast({ tone: 'error', message: t('diagrams.screen.insertFailed', { reason: 'page' }) });
      return;
    }
    const parent = layerIdOf(xml, pageId) ?? '1';
    const placed = placeFreeCells(free.specs, { bounds: state.bounds, parent, previous: lastChildId(xml, pageId, parent), newId: newCellId });
    frame.current?.send({ action: 'patch', patch: insertPatch(pageId, placed.cells) });
    state.bounds = placed.bounds;
    setDirty(true);
    toast({ tone: 'ok', message: free.message });
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
        // Máy đã lưu nằm sai khung tủ: báo ngay khi mở, không đợi người vẽ sửa gì.
        if (!ready) racks.fit(content.version?.xml ?? '', { warnOnly: true });
        setReady(true);
        break;
      case 'autosave':
        setDirty(true);
        if (message.xml) {
          setFrameXml(message.xml);
          setJustInserted([]);
          cables.onAutosave(message.xml);
          racks.fit(message.xml);
        }
        break;
      case 'patch':
        if (message.error) toast({ tone: 'error', message: t('diagrams.screen.insertFailed', { reason: message.error }) });
        break;
      case 'save':
        /*
         * Ctrl+S trong trình vẽ cũng tới đây, kể cả khi nút Lưu đang tắt: chưa sửa gì thì chỉ báo,
         * không xin trình vẽ xuất, không gọi server (Q-23 — mỗi lần lưu là một phiên bản).
         */
        if (!dirty && !needsPreview) {
          toast({ tone: 'warn', message: t('diagrams.screen.nothingToSave') });
          break;
        }
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
  const presentationTools = usePresentationTools({
    disabled: !ready,
    xmlMaxKb: settings.xmlMaxKb,
    onInsert: (specs, message) =>
      withFile((xml) => {
        if (!xml) return;
        setFrameXml(xml);
        insertFreeInto(xml, { specs, message });
      }),
  });
  /* Thanh mảnh là MỘT dòng (E-04): dòng trạng thái gọn "Đã lưu #n · giờ", đủ phiên bản / người lưu
     trong chú thích khi rê chuột — chữ dài bị cắt "…" thì người dùng không đọc được gì. */
  const savedFull = dirty
    ? t('diagrams.screen.unsaved')
    : lastSaved
      ? t('diagrams.screen.savedAt', {
          version: diagramVersionLabel(t, lastSaved.seq, content.diagram.officialSeq),
          at: formatDateTime(lastSaved.savedAt),
          by: lastSaved.savedByName ?? lastSaved.savedBy,
        })
      : t('diagrams.screen.neverSaved');
  const savedNote = !dirty && lastSaved ? t('diagrams.screen.savedShort', { seq: lastSaved.seq, at: formatDateTime(lastSaved.savedAt) }) : savedFull;
  const status = (
    <>
      {reviewStatus}
      {others.length > 0 ? (
        <p className="badge warn" role="status">
          {t('diagrams.screen.presence', { names: others.map((o) => o.fullName).join(', ') })}
        </p>
      ) : null}
      {cables.status}
      <p className="muted full-bar-note" role="status" title={savedFull}>
        {savedNote}
      </p>
    </>
  );

  return (
    <ScreenFrame
      diagramId={diagramId}
      title={title}
      tabs={tabs}
      dialogs={dialogs}
      band={band}
      primary={
        <>
          <Popover label={t('diagrams.stock.button')} title={t('diagrams.stock.title')} open={stockOpen} onOpenChange={setStockOpen} disabled={!ready}>
            <StockDevicePicker present={present} busy={inserting} onInsert={(ids) => void insert(ids)} />
          </Popover>
          <InfoTip subject={t('diagrams.stock.button')}>{t('diagrams.help.stock')}</InfoTip>
          <button
            type="button"
            className="btn primary"
            disabled={!ready || busy || (!dirty && !needsPreview)}
            title={ready && !busy && !dirty && !needsPreview ? t('diagrams.screen.nothingToSave') : undefined}
            onClick={() => frame.current?.send({ action: 'save' })}
          >
            {busy ? t('diagrams.screen.saving') : t('diagrams.screen.save')}
          </button>
          <InfoTip subject={t('diagrams.screen.save')}>{t('diagrams.help.save')}</InfoTip>
        </>
      }
      menu={[
        ...(content.diagram.kind === 'presentation' ? presentationTools.menu : []),
        ...frames.menu,
        ...racks.menu,
        ...photos.menu,
        ...(isRack
          ? [{ key: 'rebuild-rack', label: t('diagrams.rack.rebuildButton'), disabled: !ready || rebuilding, onSelect: () => void rebuildRack() }]
          : []),
        ...cables.menu,
        { key: 'draft', label: t('diagrams.cable.draftButton'), disabled: !ready, onSelect: () => setDraftOpen(true) },
        ...reviewMenu,
        versionsAction,
      ]}
      popovers={
        <>
          {frames.popovers}
          {cables.popovers}
          {reviewPopovers}
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
          {/* `content` là bản đã cache lúc mở và không tải lại sau khi lưu (tải lại = nạp lại khung đang
              vẽ), nên "trống" phải xét cả `lastSaved`. */}
          {!lastSaved && !dirty && !startDismissed ?<EditStartCard onDismiss={() => setStartDismissed(true)} /> : null}
          {cables.dialogs}
          {frames.dialogs}
          {photos.dialogs}
          {racks.dialogs}
          {content.diagram.kind === 'presentation' ? presentationTools.elements : null}
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
                if (version.unchanged) {
                  toast({ tone: 'warn', message: t('diagrams.cable.draftSame') });
                  return;
                }
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
  t: (key: string, options?: Record<string, unknown>) => string,
): {
  cells: ViewerCell[];
  byCell: Map<string, { device: DiagramDeviceInfo | null; code: string }>;
  byEdge: Map<string, { edge: CableEdge; link: DiagramLink | null }>;
  byFrame: Map<string, DiagramFrame>;
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
  /*
   * Khung bản vẽ con / khung VLAN bấm được (FR-039). Bản vẽ con đã lưu trữ hay không còn: dấu vàng,
   * bấm chỉ báo — không vỡ trang. Khung tủ không có bản vẽ con thì là hình thường.
   */
  const byFrame = new Map<string, DiagramFrame>();
  for (const frame of content.frames ?? []) {
    if (!frame.childDiagramId && !frame.subnetId) continue;
    byFrame.set(frame.cellId, frame);
    if (frame.childDiagramId) {
      if (!frame.child) cells.push({ id: frame.cellId, label: t('diagrams.frames.childMissing'), mark: 'warn' });
      else if (frame.child.archived) cells.push({ id: frame.cellId, label: t('diagrams.frames.childArchived', { name: frame.child.name }), mark: 'warn' });
      else cells.push({ id: frame.cellId, label: t('diagrams.frames.openChild', { name: frame.child.name }) });
    } else {
      cells.push({ id: frame.cellId, label: t('diagrams.frames.vlanCell', { name: frame.label }) });
    }
  }
  return { cells, byCell, byEdge, byFrame };
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
