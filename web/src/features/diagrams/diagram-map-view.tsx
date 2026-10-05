import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { agoParts, formatDateTime } from '@/lib/format';
import { NODE_TYPE_KEY, STATUS_KEY, statusLabel, type DiagramNode } from './diagram-api';
import { filterActive, matchCountInside, nodeMatches, tileTone, type DiagramMap, type MapFilter, type TileTone } from './diagram-map';
import { flattenTree } from './diagram-tree';

type Translate = (key: string, options?: Record<string, unknown>) => string;

const BADGE_OF: Record<TileTone, string> = {
  ok: 'badge ok',
  warn: 'badge warn',
  info: 'badge info',
  danger: 'badge danger',
  muted: 'badge muted',
};

/** "v8 · Thuận · 3 ngày trước" — lần lưu mới nhất; cũ hơn 30 ngày thì ghi ngày giờ. */
function savedLine(node: DiagramNode, t: Translate, now: number): string {
  const latest = node.latestVersion;
  if (!latest) return t('diagrams.map.never');
  const ago = agoParts(latest.savedAt, now);
  const when = !ago ? '' : ago.unit === 'days' && ago.count > 30 ? formatDateTime(latest.savedAt) : t(`diagrams.map.ago_${ago.unit}`, { count: ago.count });
  return [t('diagrams.map.version', { seq: latest.seq }), latest.savedByName ?? latest.savedBy, when].filter(Boolean).join(' · ');
}

/** "v12 · 3 Bản nháp" — bản chính thức + số lần lưu chưa phát hành (ô nhỏ không đủ chỗ cho tên người). */
function tileLine(node: DiagramNode, t: Translate): string {
  if (!node.latestVersion) return t('diagrams.map.never');
  const parts: string[] = [];
  if (node.officialSeq) parts.push(t('diagrams.map.version', { seq: node.officialSeq }));
  if (node.draftCount) parts.push(t('diagrams.map.drafts', { count: node.draftCount }));
  return parts.join(' · ') || t('diagrams.map.version', { seq: node.latestVersion.seq });
}

/** Chữ trạng thái (luôn có — màu chỉ đi kèm) + lệch kho nếu có. */
function statusText(node: DiagramNode, t: Translate, withSeq: boolean): string {
  const base = withSeq ? statusLabel(node, t) : t(STATUS_KEY[node.status]);
  return node.driftCount ? `${base} · ${t('diagrams.drift.treeBadge', { count: node.driftCount })}` : base;
}

interface ViewProps {
  map: DiagramMap;
  nodes: DiagramNode[];
  selected: string | null;
  filter: MapFilter;
  now: number;
  onSelect: (id: string) => void;
  onDrill: (id: string) => void;
  onAddChild: (parent: DiagramNode) => void;
}

/**
 * Bản đồ bản vẽ (Q-23): gốc là băng tối, con là khu (thẻ đầu khu = chính bản vẽ khu), cháu là ô;
 * ô có con thì có nút "▸ n bản vẽ con" để đi sâu. Đang lọc thì nút không khớp mờ đi chứ không
 * biến mất — người dùng vẫn thấy nó nằm đâu trong công ty.
 */
export function DiagramMapView({ map, nodes, selected, filter, now, onSelect, onDrill, onAddChild }: ViewProps) {
  const { t } = useTranslation();
  const filtering = filterActive(filter);
  const dim = (node: DiagramNode) => (filtering && !nodeMatches(node, filter) ? 'true' : undefined);
  const current = (node: DiagramNode) => (node.id === selected ? true : undefined);

  return (
    <div className="dmap" aria-label={t('diagrams.map.mapLabel')} role="region">
      {map.roots.map((root) => (
        <section
          key={root.node.id}
          // Gốc chưa có con chỉ là một băng một dòng kèm nút thêm bản vẽ con: khối gợi ý trống chiếm chỗ
          // của các gốc có nội dung bên dưới.
          className={root.areas.length === 0 ? 'dmap-root dmap-root-compact' : 'dmap-root'}
          aria-labelledby={`dmap-root-${root.node.id}`}
        >
          <button
            type="button"
            className="dmap-banner"
            aria-current={current(root.node)}
            data-dim={dim(root.node)}
            onClick={() => onSelect(root.node.id)}
          >
            <span className="dmap-banner-text">
              <span className="dmap-kicker">{t(NODE_TYPE_KEY[root.node.nodeType])}</span>{' '}
              <strong id={`dmap-root-${root.node.id}`} className="dmap-banner-name">
                {root.node.name}
              </strong>{' '}
              <span className="dmap-banner-meta">
                {[savedLine(root.node, t, now), root.descendants > 0 ? t('diagrams.map.inside', { count: root.descendants }) : null].filter(Boolean).join(' · ')}
              </span>
            </span>{' '}
            <span className={BADGE_OF[tileTone(root.node)]}>{statusText(root.node, t, true)}</span>
          </button>
          {root.areas.length === 0 ? (
            <div className="dmap-add dmap-add-inline">
              <button type="button" aria-label={t('diagrams.addChildOf', { name: root.node.name })} onClick={() => onAddChild(root.node)}>
                {t('diagrams.map.addInto', { name: root.node.name })}
              </button>
            </div>
          ) : (
            <ul className="dmap-areas">
              {root.areas.map((area) => (
                <li key={area.node.id} className="dmap-area" data-dim={dim(area.node) && area.tiles.every((tile) => !nodeMatches(tile.node, filter)) ? 'true' : undefined}>
                  <button
                    type="button"
                    className="dmap-area-head"
                    aria-current={current(area.node)}
                    data-dim={dim(area.node)}
                    onClick={() => onSelect(area.node.id)}
                  >
                    <span className="dmap-area-title">
                      <strong>{area.node.name}</strong>{' '}
                      <span className={BADGE_OF[tileTone(area.node)]}>{statusText(area.node, t, true)}</span>
                    </span>{' '}
                    <span className="dmap-meta">{savedLine(area.node, t, now)}</span>
                  </button>
                  <ul className="dmap-tiles" aria-label={t('diagrams.panel.siblingsOf', { name: area.node.name })}>
                    {area.tiles.map((tile) => {
                      const inside = filtering && tile.children > 0 ? matchCountInside(nodes, tile.node.id, filter) : 0;
                      return (
                        <li
                          key={tile.node.id}
                          className="dmap-tile"
                          data-tone={tileTone(tile.node)}
                          data-selected={current(tile.node) ? 'true' : undefined}
                          data-dim={dim(tile.node) && inside === 0 ? 'true' : undefined}
                        >
                          <button type="button" className="dmap-tile-main" aria-current={current(tile.node)} onClick={() => onSelect(tile.node.id)}>
                            <span className="dmap-tile-name">{tile.node.name}</span>{' '}
                            <span className="dmap-status">
                              <span className="dmap-dot" aria-hidden="true" />
                              {statusText(tile.node, t, false)}
                            </span>{' '}
                            <span className="dmap-meta">{tileLine(tile.node, t)}</span>
                          </button>
                          {tile.children > 0 ? (
                            <button
                              type="button"
                              className="dmap-drill"
                              aria-label={t('diagrams.map.drillOf', { count: tile.children, name: tile.node.name })}
                              onClick={() => onDrill(tile.node.id)}
                            >
                              <span aria-hidden="true">▸</span>
                              {t('diagrams.map.drill', { count: tile.children })}
                              {inside > 0 ? <span className="badge info">{t('diagrams.map.drillMatches', { count: inside })}</span> : null}
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                    <li className="dmap-add">
                      <button type="button" aria-label={t('diagrams.addChildOf', { name: area.node.name })} onClick={() => onAddChild(area.node)}>
                        {t('diagrams.map.addInto', { name: area.node.name })}
                      </button>
                    </li>
                  </ul>
                </li>
              ))}
              {/* Nút này đứng cạnh nút thêm của khu cuối: chữ phải nói ĐÍCH, không thì bấm nhầm là bản vẽ
                  nằm sai nhánh. */}
              <li className="dmap-add dmap-add-area">
                <button type="button" aria-label={t('diagrams.addChildOf', { name: root.node.name })} onClick={() => onAddChild(root.node)}>
                  {t('diagrams.map.addArea', { name: root.node.name })}
                </button>
              </li>
            </ul>
          )}
        </section>
      ))}
      {map.presentations.length > 0 ? (
        <section className="dmap-presentations" aria-labelledby="dmap-presentations-title">
          <h2 id="dmap-presentations-title" className="form-section-title">
            {t('diagrams.map.presentations', { count: map.presentations.length })}
          </h2>
          <ul className="dmap-chips">
            {map.presentations.map((node) => (
              <li key={node.id}>
                <button type="button" className="dmap-chip" aria-current={current(node)} data-dim={dim(node)} onClick={() => onSelect(node.id)}>
                  {node.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/**
 * Kiểu "Danh sách": cây thụt lề phẳng, mở hết — cho người đọc màn hình và ai quen danh sách.
 * Bấm tên = chọn (panel bên cạnh), như bấm ô trên bản đồ.
 */
export function DiagramListView({ nodes, selected, filter, onSelect }: Pick<ViewProps, 'nodes' | 'selected' | 'filter' | 'onSelect'>) {
  const { t } = useTranslation();
  const official = nodes.filter((n) => n.kind !== 'presentation');
  const presentations = nodes.filter((n) => n.kind === 'presentation');
  const filtering = filterActive(filter);
  const row = (node: DiagramNode, depth: number) => (
    <li
      key={node.id}
      className="tree-row dmap-list-row"
      style={{ '--depth': depth } as CSSProperties}
      data-dim={filtering && !nodeMatches(node, filter) ? 'true' : undefined}
    >
      <button type="button" className="linkbtn tree-name" aria-current={node.id === selected ? 'true' : undefined} onClick={() => onSelect(node.id)}>
        {node.name}
      </button>
      {node.kind === 'presentation' ? (
        <span className="badge brand">{t('diagrams.presentation.badge')}</span>
      ) : (
        <>
          <span className="badge outline">{t(NODE_TYPE_KEY[node.nodeType])}</span>
          <span className={BADGE_OF[tileTone(node)]}>{statusText(node, t, true)}</span>
        </>
      )}
    </li>
  );
  return (
    <ul className="tree-list dmap-list" aria-label={t('diagrams.treeLabel')}>
      {flattenTree(official, new Set()).map(({ node, depth }) => row(node, depth))}
      {presentations.map((node) => row(node, 0))}
    </ul>
  );
}
