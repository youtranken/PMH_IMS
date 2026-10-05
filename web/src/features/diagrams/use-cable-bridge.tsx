import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { BulkLinkDialog } from '@/ui/bulk-link-dialog';
import { useConfirm } from '@/ui/confirm-provider';
import { paintImsStyle, type DrawioCommand } from '@/ui/drawio-protocol';
import { PortFormDialog } from '@/ui/port-form-dialog';
import { useToast } from '@/ui/toast';
import { CableDeclareDialog, fetchDiagramLinks } from './cable-declare-dialog';
import { bindEdgeValue, diffAutosave, edgeById, firstDeviceCell, pendingEdges, styleWithoutImsEdge, type NewEdge } from './cable-diff';
import { CableLegend } from './cable-legend';
import { cableRoutePatch, orthogonalStyle, type CableRouteMode } from './cable-route';
import { BarPopover, type BarAction } from './diagram-bar';
import type { DiagramContent, DiagramLink } from './diagram-api';
import { escapeXmlAttr, insertPatch, lastChildId, layerIdOf, pageIds } from './drawio-bridge';
import { deviceCellsOnPage } from './photo-bridge';

/** Lời báo "đã khai" có nút chỉ chỗ — để lâu hơn mặc định cho người kịp bấm. */
const DECLARED_TOAST_MS = 8000;

/** Ô màu IMS trong style server dựng (`imsPaint=cable-2`) — giữ nguyên khi gắn nét. */
function paintTokenOf(style: string): string {
  return /(?:^|;)(imsPaint=[a-z0-9-]+)/.exec(style)?.[1] ?? 'imsPaint=cable-0';
}

/**
 * Cầu nối DÂY của màn sửa (Q-23 "vẽ là khai, có hỏi", AD-18): so hai lần `autosave` để hỏi
 * "Khai" khi có nét mới nối hai máy kho và "Chỉ xoá nét vẽ / Gỡ luôn kết nối" khi nét đã khai bị
 * xoá; giữ danh sách "Có N kết nối mới chưa vẽ"; nút "Dây chưa khai", "Khai kết nối", "Nối hàng
 * loạt", chú giải màu. Mọi lượt GHI sơ đồ cổng là web gọi endpoint của `devices` sau một nút bấm
 * trong hộp IMS; lưu bản vẽ không ghi gì vào sơ đồ cổng.
 *
 * Sửa nét trên trình vẽ dùng `patch` trên cả tệp xin bằng `export` xml (`withFile`) — biết trang
 * và lớp, không đụng phần người vẽ chưa lưu.
 */
export function useCableBridge({
  me,
  content,
  ready,
  withFile,
  send,
  page,
  markDirty,
  palette,
  newId,
}: {
  me: Me;
  content: DiagramContent;
  ready: boolean;
  withFile: (fn: (xml: string) => void) => void;
  send: (command: DrawioCommand) => void;
  page: () => number;
  markDirty: () => void;
  /** Ô màu → mã màu draw.io, đọc từ token lúc chạy (`readCablePalette`). */
  palette: Record<string, string>;
  newId: () => string;
}): {
  onAutosave: (xml: string) => void;
  refreshUndrawn: (xml: string) => void;
  /** Việc của dây cho menu ⋮ của thanh; hộp nổi của chúng ở `popovers`. */
  menu: BarAction[];
  popovers: ReactNode;
  status: ReactNode;
  dialogs: ReactNode;
} {
  const { t } = useTranslation();
  const toast = useToast();
  const ask = useConfirm();
  const cableTypes = content.cableTypes ?? [];
  const lastXml = useRef(content.version?.xml ?? '');
  const links = useRef(new Map((content.links ?? []).map((l) => [l.id, l])));
  const [currentXml, setCurrentXml] = useState(content.version?.xml ?? '');
  const [queue, setQueue] = useState<NewEdge[]>([]);
  const [undrawn, setUndrawn] = useState<DiagramLink[]>(() => {
    const ids = new Set(content.undrawnLinkIds ?? []);
    return (content.links ?? []).filter((l) => ids.has(l.id));
  });
  const [undeclaredOpen, setUndeclaredOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [declareOpen, setDeclareOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  /* Máy trên trang đang vẽ — hộp Khai kết nối / Nối hàng loạt mời chọn nhanh (E-05, E-09). */
  const [onDrawing, setOnDrawing] = useState<{ id: string; code: string }[]>([]);
  const openWithDrawing = (open: () => void) =>
    withFile((file) => {
      const pages = pageIds(file);
      const pageId = pages[Math.min(page(), pages.length - 1)];
      const seen = new Map<string, { id: string; code: string }>();
      for (const cell of pageId ? deviceCellsOnPage(file, pageId) : []) {
        if (!seen.has(cell.deviceId)) seen.set(cell.deviceId, { id: cell.deviceId, code: cell.code });
      }
      setOnDrawing([...seen.values()]);
      open();
    });

  /*
   * Kết nối vừa khai NẰM Ở sơ đồ cổng của máy giữ dòng (Q-23): lời báo chỉ chỗ. Mở tab mới — rời
   * màn sửa là bỏ dở bản vẽ chưa lưu.
   */
  const portMapAction = (link: { deviceId: string; deviceCode: string }) => ({
    label: t('diagrams.cable.openPortMap', { code: link.deviceCode }),
    onClick: () => window.open(`${PATHS.device(link.deviceId)}?tab=ports`, '_blank', 'noopener'),
  });

  const remember = (list: DiagramLink[]) => {
    for (const link of list) links.current.set(link.id, link);
  };

  /** Cập nhật một nét bằng `patch` (giá trị + style) trên trang đang mở. */
  const updateEdge = (file: string, edgeId: string, change: (edge: NonNullable<ReturnType<typeof edgeById>>) => Record<string, string>) => {
    const pages = pageIds(file);
    const pageId = pages[Math.min(page(), pages.length - 1)];
    const edge = edgeById(file, edgeId);
    if (!pageId || !edge) return;
    send({ action: 'patch', patch: { u: { [pageId]: { cells: { u: { [edgeId]: change(edge) } } } } } });
    markDirty();
  };

  const bindEdge = (edge: NewEdge, link: DiagramLink) => {
    remember([link]);
    withFile((file) =>
      updateEdge(file, edge.id, (current) => ({
        xmlValue: bindEdgeValue(edge.id, current.attrs, {
          label: link.deviceId === edge.sourceDeviceId ? link.labelFromA : link.labelFromB,
          ims_link_id: link.id,
          ims_cable_type_id: link.cableTypeId ?? '',
        }),
        // Dây của kho là nét vuông góc (Q-23): người vẽ bẻ bằng điểm uốn của chính nét, kể cả nét
        // vừa vẽ bằng công cụ nét thẳng rồi bấm Khai.
        style: paintImsStyle(`${orthogonalStyle(styleWithoutImsEdge(current.style))}${paintTokenOf(link.edgeStyle)};html=0;`, palette),
      })),
    );
  };

  /** "Chỉ vẽ": nét ở lại, không `ims_link_id`, viền vàng + chú "Chưa khai vào sơ đồ cổng". */
  const markUndeclared = (edge: NewEdge) => {
    withFile((file) =>
      updateEdge(file, edge.id, (current) => {
        const style = paintImsStyle(`${styleWithoutImsEdge(current.style)}imsPaint=warn;dashed=1;html=0;`, palette);
        const label = t('diagrams.cable.undeclaredMark');
        return Object.keys(current.attrs).length > 0
          ? { xmlValue: bindEdgeValue(edge.id, current.attrs, { label }), style }
          : { value: label, style };
      }),
    );
  };

  /** Bản sao của nét đã khai (nhân bản / dán) bỏ `ims_link_id` — không để hai nét cùng một kết nối. */
  const stripLinks = (ids: string[]) => {
    withFile((file) => {
      for (const id of ids) {
        updateEdge(file, id, (current) => ({
          xmlValue: bindEdgeValue(id, current.attrs, { label: '' }, ['ims_link_id', 'ims_cable_type_id']),
          style: styleWithoutImsEdge(current.style),
        }));
      }
    });
  };

  const askRemove = async (removed: { id: string; linkId: string }[]) => {
    const known = removed.map((r) => links.current.get(r.linkId)).filter((l): l is DiagramLink => Boolean(l));
    if (known.length === 0) return;
    const names = known.map((l) => `${l.deviceCode} ${l.portLabel} ↔ ${l.peerDeviceCode} ${l.peerPort ?? '—'}`);
    // Nút mặc định (✕, Esc, Enter ở nút đóng) = "Chỉ xoá nét vẽ": không gọi gì.
    const remove = await ask({
      title: t('diagrams.cable.removeTitle'),
      message: t('diagrams.cable.removeMessage', { links: names.join('; ') }),
      cancelLabel: t('diagrams.cable.removeOnlyDrawing'),
      confirmLabel: t('diagrams.cable.removeLink'),
      danger: true,
    });
    if (!remove) {
      // Chỉ xoá nét: kết nối vẫn còn, giờ là "chưa vẽ" — dải "Vẽ vào" phải thấy nó ngay.
      withFile((file) => refreshUndrawn(file));
      return;
    }
    let done = 0;
    for (const [i, link] of known.entries()) {
      try {
        await apiFetch(`/api/v1/devices/${link.deviceId}/ports/${link.id}/unlink`, { method: 'POST', csrfToken: me.csrfToken });
        links.current.delete(link.id);
        done += 1;
      } catch (error) {
        toast({ tone: 'error', message: t('diagrams.cable.removeFailed', { label: names[i], reason: errorMessage(error) }) });
      }
    }
    if (done > 0) toast({ tone: 'ok', message: t('diagrams.cable.removed', { count: done }) });
  };

  /**
   * "Bẻ dây vuông góc" / "Tự đi lại dây" (Q-23): một lệnh `patch` cho mọi dây của kho trên trang
   * đang mở — giao thức nhúng không cho biết đang chọn nét nào.
   */
  const route = (mode: CableRouteMode) =>
    withFile((file) => {
      const pages = pageIds(file);
      const pageId = pages[Math.min(page(), pages.length - 1)];
      if (!pageId) return;
      const ends = new Map([...links.current.values()].map((l) => [l.id, { a: l.deviceId, b: l.peerDeviceId }]));
      const result = cableRoutePatch(file, pageId, ends, mode);
      if (result.count === 0) {
        toast({ tone: 'warn', message: t(mode === 'orthogonal' ? 'diagrams.cable.orthogonalNothing' : 'diagrams.cable.rerouteNothing') });
        return;
      }
      send({ action: 'patch', patch: { u: { [pageId]: { cells: { u: result.updates } } } } });
      markDirty();
      if (mode === 'orthogonal') {
        toast({ tone: 'ok', message: t('diagrams.cable.orthogonalDone', { count: result.count }) });
        return;
      }
      toast({ tone: 'ok', message: t('diagrams.cable.rerouteDone', { count: result.count, reattached: result.reattached }) });
      if (result.stuck.length > 0) toast({ tone: 'warn', message: t('diagrams.cable.rerouteStuck', { count: result.stuck.length }) });
    });

  const onAutosave = (xml: string) => {
    const diff = diffAutosave(lastXml.current, xml, new Set(links.current.keys()));
    lastXml.current = xml;
    setCurrentXml(xml);
    if (diff.strip.length > 0) stripLinks(diff.strip);
    // Nét đang chờ hỏi mà người vẽ đã hoàn tác/xoá thì thôi hỏi.
    setQueue((current) => {
      const alive = current.filter((e) => edgeById(xml, e.id));
      const fresh = diff.added.filter((e) => !alive.some((q) => q.id === e.id));
      return [...alive, ...fresh];
    });
    if (diff.removed.length > 0) void askRemove(diff.removed);
  };

  /** Chèn nét cho các kết nối có HAI đầu trên bản vẽ; máy chưa có trên bản vẽ thì chỉ ghi kho. */
  const drawLinks = (list: DiagramLink[]) => {
    if (list.length === 0) return;
    remember(list);
    withFile((file) => {
      const pages = pageIds(file);
      const pageId = pages[Math.min(page(), pages.length - 1)];
      if (!pageId) return;
      const parent = layerIdOf(file, pageId) ?? '1';
      let previous = lastChildId(file, pageId, parent);
      const cells = list.flatMap((link) => {
        const source = firstDeviceCell(file, link.deviceId);
        const target = firstDeviceCell(file, link.peerDeviceId);
        if (!source || !target) return [];
        const id = newId();
        const cell = {
          id,
          edge: 1,
          parent,
          ...(previous ? { previous } : {}),
          source,
          target,
          style: paintImsStyle(link.edgeStyle, palette),
          geometry: '<mxGeometry relative="1" as="geometry"/>',
          xmlValue: `<UserObject label="${escapeXmlAttr(link.labelFromA)}" ims_link_id="${escapeXmlAttr(link.id)}" ims_cable_type_id="${escapeXmlAttr(link.cableTypeId ?? '')}" id="${escapeXmlAttr(id)}"/>`,
        };
        previous = id;
        return [cell];
      });
      if (cells.length === 0) return;
      send({ action: 'patch', patch: insertPatch(pageId, cells) });
      markDirty();
      toast({ tone: 'ok', message: t('diagrams.cable.drawn', { count: cells.length }) });
    });
  };

  /** "Có N kết nối mới chưa vẽ" theo XML đang vẽ (sau khi chèn máy) — luật ở server. */
  const refreshUndrawn = (xml: string) => {
    void apiFetch<{ undrawn: DiagramLink[] }>('/api/v1/diagrams/cable-status', {
      method: 'POST',
      csrfToken: me.csrfToken,
      body: JSON.stringify({ xml }),
    })
      .then((res) => {
        remember(res.undrawn);
        setUndrawn(res.undrawn);
      })
      .catch(() => undefined);
  };

  const current = queue[0] ?? null;
  const dequeue = () => setQueue((q) => q.slice(1));
  // Chọn nét đỏ là khai lại: kết nối mới thay `ims_link_id` cũ trên đúng nét đó, và lần autosave
  // kế tiếp đưa nó ra khỏi danh sách.
  const undeclared = pendingEdges(currentXml, content.cableEdges ?? []);

  const menu: BarAction[] = [
    { key: 'declare', label: t('diagrams.cable.declareButton'), disabled: !ready, onSelect: () => openWithDrawing(() => setDeclareOpen(true)) },
    { key: 'bulk', label: t('diagrams.cable.bulkButton'), disabled: !ready, onSelect: () => openWithDrawing(() => setBulkOpen(true)) },
    { key: 'undeclared', label: t('diagrams.cable.undeclaredButton'), disabled: !ready, onSelect: () => setUndeclaredOpen(true) },
    { key: 'cable-orthogonal', label: t('diagrams.cable.orthogonalButton'), disabled: !ready, onSelect: () => route('orthogonal') },
    { key: 'cable-reroute', label: t('diagrams.cable.rerouteButton'), disabled: !ready, onSelect: () => route('reroute') },
    { key: 'legend', label: t('diagrams.cable.legend'), onSelect: () => setLegendOpen(true) },
  ];
  const popovers = (
    <>
      <BarPopover title={t('diagrams.cable.undeclaredTitle')} open={undeclaredOpen} onOpenChange={setUndeclaredOpen}>
        {undeclared.length === 0 ? (
          <p className="muted">{t('diagrams.cable.undeclaredEmpty')}</p>
        ) : (
          <ul className="device-card-diagrams">
            {undeclared.map((edge) => (
              <li key={edge.id}>
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => {
                    setUndeclaredOpen(false);
                    setQueue((q) => [edge, ...q.filter((e) => e.id !== edge.id)]);
                  }}
                >
                  {t('diagrams.cable.undeclaredItem', { from: edge.sourceCode, to: edge.targetCode })}
                </button>
              </li>
            ))}
          </ul>
        )}
      </BarPopover>
      <BarPopover title={t('diagrams.cable.legendTitle')} open={legendOpen} onOpenChange={setLegendOpen}>
        <CableLegend cableTypes={cableTypes} />
      </BarPopover>
    </>
  );

  const status =
    undrawn.length > 0 ? (
      <p className="badge info" role="status">
        {t('diagrams.cable.undrawn', { n: undrawn.length })}{' '}
        <button
          type="button"
          className="btn sm"
          disabled={!ready}
          onClick={() => {
            drawLinks(undrawn);
            setUndrawn([]);
          }}
        >
          {t('diagrams.cable.drawIn')}
        </button>
      </p>
    ) : null;

  const dialogs = (
    <>
      {current ? (
        <CableDeclareDialog
          key={current.id}
          me={me}
          edge={current}
          cableTypes={cableTypes}
          onDeclared={(link) => {
            bindEdge(current, link);
            toast({
              tone: 'ok',
              message: t('diagrams.cable.declared', { label: `${link.deviceCode} ${link.portLabel} ↔ ${link.peerDeviceCode} ${link.peerPort ?? '—'}` }),
              durationMs: DECLARED_TOAST_MS,
              action: portMapAction(link),
            });
            dequeue();
          }}
          onBind={(link) => {
            bindEdge(current, link);
            toast({ tone: 'ok', message: t('diagrams.cable.bound', { label: link.labelFromA }) });
            dequeue();
          }}
          onDrawOnly={() => {
            markUndeclared(current);
            dequeue();
          }}
        />
      ) : null}
      {declareOpen ? (
        <PortFormDialog
          device={null}
          port={null}
          csrfToken={me.csrfToken}
          onDrawing={onDrawing}
          onClose={() => setDeclareOpen(false)}
          onSaved={(keepOpen, saved) => {
            if (!keepOpen) setDeclareOpen(false);
            if (!saved.connectedDeviceId) return;
            void fetchDiagramLinks([saved.id])
              .then((list) => {
                drawLinks(list);
                const [link] = list;
                if (link) toast({ tone: 'ok', message: t('diagrams.cable.declaredWhere', { code: link.deviceCode }), durationMs: DECLARED_TOAST_MS, action: portMapAction(link) });
              })
              .catch(() => undefined);
          }}
        />
      ) : null}
      {bulkOpen ? (
        <BulkLinkDialog
          device={null}
          csrfToken={me.csrfToken}
          onDrawing={onDrawing}
          onClose={() => setBulkOpen(false)}
          onDone={(created, code) => {
            setBulkOpen(false);
            toast({ tone: 'ok', message: t('ports.bulkDone', { count: created.length, code }) });
            void fetchDiagramLinks(created.map((l) => l.id)).then(drawLinks).catch(() => undefined);
          }}
        />
      ) : null}
    </>
  );

  return { onAutosave, refreshUndrawn, menu, popovers, status, dialogs };
}
