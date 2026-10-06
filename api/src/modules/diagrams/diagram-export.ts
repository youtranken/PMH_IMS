import { escapeXmlAttr, escapeXmlText } from '../../common/svg-sanitize';
import { PALETTE } from '../../common/palette.generated';
import { dateTimeInTz } from '../../common/today';
import type { CellIndex } from './diagram-cells';
import { presentationBand } from './diagram-presentation';

/**
 * Ghép file xuất của một phiên bản bản vẽ (FR-044, AD-17) — hàm THUẦN, test ở
 * `diagram-export.spec.ts`. Server dựng từ SVG ĐÃ LƯU (đã qua cổng làm sạch lúc lưu), không nhận
 * ảnh từ client: chân trang và watermark là bằng chứng nộp ISO, client tự vẽ thì giả được.
 */

/**
 * `superseded` = từng là bản chính thức, đã bị phiên bản khác thay. Bản trình bày (`kind`) không
 * bao giờ chính thức — dải trình bày thắng mọi trạng thái.
 */
export type ExportStatus = 'official' | 'superseded' | 'draft';

export interface ExportMeta {
  /** Tên các bản vẽ từ gốc cây tới bản vẽ này. */
  path: string[];
  kind: 'official' | 'presentation';
  seq: number;
  versionLabel: string | null;
  status: ExportStatus;
  approvedAt: Date | null;
  approvedBy: string | null;
  drawnBy: string;
  savedAt: Date;
  exporter: { fullName: string; email: string };
  exportedAt: Date;
  timeZone: string;
  /** Bản trình bày: số phiên bản chính thức đã nhân bản ra nó (`null` = chưa biết). */
  presentationBaseSeq?: number | null;
  /** Bản cũ đã bị thay: số phiên bản chính thức hiện hành. */
  supersededBySeq?: number | null;
}

export interface LegendItem {
  label: string;
  /** `#rrggbb` đọc từ nét dây trong SVG đã lưu; giá trị khác bị bỏ. */
  color: string;
}

export interface ExportBand {
  title: string;
  sub: string | null;
}

/*
 * File xuất là giấy in nộp hồ sơ: luôn nền sáng, không theo theme của người xuất — nên lấy bản
 * SÁNG của token (`PALETTE`, sinh từ `tokens.css`; AD-15).
 */
const PAPER = {
  background: PALETTE.surface,
  ink: PALETTE.ink,
  muted: PALETTE.muted,
  rule: PALETTE.paperRule,
  watermark: PALETTE.ink,
  draft: { fill: PALETTE.paperDraft, ink: PALETTE.warn },
  superseded: { fill: PALETTE.paperSuperseded, ink: PALETTE.danger },
  presentation: { fill: PALETTE.paperPresentation, ink: PALETTE.info },
} as const;

const FONT = 'DejaVu Sans';
const PAD = 24;
const MIN_CONTENT_WIDTH = 760;
const BAND_HEIGHT = 56;
const LEGEND_ROW = 22;
const FOOTER_LINE = 18;
const WATERMARK_STEP_X = 320;
const WATERMARK_STEP_Y = 150;
/** Trần số dòng watermark: bản vẽ khổng lồ thì giãn lưới thay vì sinh hàng nghìn phần tử chữ. */
const WATERMARK_MAX = 400;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function exportBand(meta: ExportMeta): ExportBand | null {
  // Dải trình bày: cùng câu với màn xem (`presentationBand`), một nguồn chữ cho cả hai.
  const presentation = presentationBand({ kind: meta.kind, source: { seq: meta.presentationBaseSeq ?? null } });
  if (presentation) return { title: presentation.title, sub: presentation.basedOn };
  if (meta.status === 'draft') return { title: 'BẢN NHÁP — chưa duyệt', sub: null };
  if (meta.status === 'superseded') {
    return {
      title: 'BẢN CŨ — không còn hiệu lực',
      sub: meta.supersededBySeq ? `Bản chính thức hiện hành là phiên bản #${meta.supersededBySeq}` : null,
    };
  }
  return null;
}

function statusText(meta: ExportMeta): string {
  if (meta.kind === 'presentation') return 'Bản trình bày';
  if (meta.status === 'official') return 'Chính thức';
  if (meta.status === 'superseded') return 'Từng là bản chính thức (đã thay)';
  return 'Bản nháp — chưa duyệt';
}

export function exportFooterLines(meta: ExportMeta): string[] {
  const version = [`Phiên bản #${meta.seq}`];
  if (meta.versionLabel) version.push(meta.versionLabel);
  version.push(statusText(meta));
  if (meta.approvedAt && meta.status !== 'draft') {
    const by = meta.approvedBy ? ` bởi ${meta.approvedBy}` : '';
    version.push(`Duyệt ${dateTimeInTz(meta.approvedAt, meta.timeZone)}${by}`);
  }
  return [
    meta.path.join(' / '),
    version.join(' · '),
    `Người vẽ: ${meta.drawnBy} (lưu ${dateTimeInTz(meta.savedAt, meta.timeZone)}) · Xuất bởi ${meta.exporter.fullName} <${meta.exporter.email}> lúc ${dateTimeInTz(meta.exportedAt, meta.timeZone)}`,
  ];
}

/** Cùng dạng watermark của trình xem/trình vẽ (`web/src/ui/drawio-protocol.ts` `watermarkText`). */
export function exportWatermark(meta: ExportMeta): string {
  return `${meta.exporter.fullName} · ${meta.exporter.email} · ${dateTimeInTz(meta.exportedAt, meta.timeZone).slice(-5)}`;
}

function attrOf(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match ? match[1] : null;
}

/** Kích thước ảnh xem: `viewBox` trước (draw.io luôn ghi), lùi về `width`/`height`. */
function svgBox(tag: string): { x: number; y: number; width: number; height: number } {
  const box = (attrOf(tag, 'viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) {
    return { x: box[0], y: box[1], width: box[2], height: box[3] };
  }
  const width = parseFloat(attrOf(tag, 'width') ?? '');
  const height = parseFloat(attrOf(tag, 'height') ?? '');
  return { x: 0, y: 0, width: Number.isFinite(width) && width > 0 ? width : 1, height: Number.isFinite(height) && height > 0 ? height : 1 };
}

function text(x: number, y: number, body: string, attrs = ''): string {
  return `<text x="${x}" y="${y}" font-family="${FONT}"${attrs}>${escapeXmlText(body)}</text>`;
}

function watermarkLayer(mark: string, width: number, height: number): string {
  let stepX = WATERMARK_STEP_X;
  let stepY = WATERMARK_STEP_Y;
  // Lưới phủ cả phần lòi ra khi xoay, nên tính trên hình vuông cạnh (rộng + cao).
  const span = width + height;
  while ((span / stepX) * (span / stepY) > WATERMARK_MAX) {
    stepX *= 1.5;
    stepY *= 1.5;
  }
  const rows: string[] = [];
  for (let y = -height; y < span; y += stepY) {
    for (let x = -height; x < span; x += stepX) {
      rows.push(text(Math.round(x), Math.round(y), mark, ' font-size="14"'));
    }
  }
  return `<g fill="${PAPER.watermark}" fill-opacity="0.12" transform="rotate(-25 ${width / 2} ${height / 2})">${rows.join('')}</g>`;
}

/**
 * SVG đã lưu → SVG xuất: dải (nếu có) + ảnh xem lồng nguyên + chú giải màu dây + chân trang,
 * watermark người xuất lặp phủ toàn hình. Ảnh xem lồng vào bằng phần tử `<svg>` con giữ đúng
 * `viewBox` gốc — không đổi toạ độ bên trong.
 */
export function composeExportSvg(stored: string, meta: ExportMeta, legend: LegendItem[]): { svg: string; width: number; height: number } {
  const open = /<svg\b[^>]*>/.exec(stored);
  const tag = open ? open[0] : '<svg>';
  const selfClosing = tag.endsWith('/>');
  const inner = open && !selfClosing ? stored.slice(open.index + tag.length, stored.lastIndexOf('</svg>')) : '';
  const box = svgBox(tag);
  const namespaces = (tag.match(/\sxmlns:[a-z]+="[^"]*"/gi) ?? []).join('');

  const band = exportBand(meta);
  const colors = legend.filter((item) => HEX_COLOR.test(item.color));
  const footer = exportFooterLines(meta);
  const contentWidth = Math.max(Math.ceil(box.width), MIN_CONTENT_WIDTH);
  const width = contentWidth + PAD * 2;

  const parts: string[] = [];
  let y = PAD;
  if (band) {
    const tone = meta.kind === 'presentation' ? PAPER.presentation : meta.status === 'superseded' ? PAPER.superseded : PAPER.draft;
    parts.push(`<rect x="${PAD}" y="${y}" width="${contentWidth}" height="${BAND_HEIGHT}" fill="${tone.fill}" stroke="${tone.ink}" stroke-width="2"/>`);
    parts.push(text(PAD + 16, y + (band.sub ? 24 : 35), band.title, ` font-size="20" font-weight="bold" fill="${tone.ink}"`));
    if (band.sub) parts.push(text(PAD + 16, y + 45, band.sub, ` font-size="13" fill="${tone.ink}"`));
    y += BAND_HEIGHT + 16;
  }
  const contentX = PAD + Math.floor((contentWidth - box.width) / 2);
  parts.push(
    `<svg x="${contentX}" y="${y}" width="${box.width}" height="${box.height}" viewBox="${box.x} ${box.y} ${box.width} ${box.height}"${namespaces}>${inner}</svg>`,
  );
  y += Math.ceil(box.height) + 16;

  if (colors.length > 0) {
    let x = PAD;
    y += 14;
    parts.push(text(x, y + 4, 'Chú giải dây:', ` font-size="12" font-weight="bold" fill="${PAPER.ink}"`));
    x += 100;
    for (const item of colors) {
      const itemWidth = 44 + item.label.length * 7;
      if (x + itemWidth > PAD + contentWidth) {
        x = PAD + 100;
        y += LEGEND_ROW;
      }
      parts.push(`<line x1="${x}" y1="${y}" x2="${x + 28}" y2="${y}" stroke="${escapeXmlAttr(item.color)}" stroke-width="3"/>`);
      parts.push(text(x + 34, y + 4, item.label, ` font-size="12" fill="${PAPER.ink}"`));
      x += itemWidth;
    }
    y += LEGEND_ROW;
  }

  parts.push(`<line x1="${PAD}" y1="${y}" x2="${PAD + contentWidth}" y2="${y}" stroke="${PAPER.rule}" stroke-width="1"/>`);
  y += 6;
  footer.forEach((line, i) => {
    y += FOOTER_LINE;
    parts.push(text(PAD, y, line, ` font-size="12" fill="${i === 0 ? PAPER.ink : PAPER.muted}"${i === 0 ? ' font-weight="bold"' : ''}`));
  });
  const height = y + PAD;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${PAPER.background}"/>` +
    parts.join('') +
    watermarkLayer(exportWatermark(meta), width, height) +
    `</svg>`;
  return { svg, width, height };
}

/**
 * Độ nét khi raster hoá: giữ `preferred` (in rõ chữ nhỏ) nếu vừa trần điểm ảnh, không thì hạ cho
 * vừa; tới 1x vẫn vượt thì từ chối — một ảnh như thế chiếm hàng trăm MB RAM của api.
 */
export function exportScale(width: number, height: number, maxMegapixels: number, preferred: number): { value: number | null; reason: string | null } {
  const limit = maxMegapixels * 1_000_000;
  const at = (scale: number) => width * height * scale * scale;
  if (at(1) > limit) {
    return { value: null, reason: `Bản vẽ quá lớn để xuất (${Math.round(at(1) / 1_000_000)} triệu điểm ảnh, trần ${maxMegapixels}).` };
  }
  if (at(preferred) <= limit) return { value: preferred, reason: null };
  return { value: Math.sqrt(limit / (width * height)), reason: null };
}

/** Màu nét đầu tiên trong nhóm `<g data-cell-id="id">` của ảnh xem (tới ô kế tiếp). */
function strokeOf(svg: string, cellId: string): string | null {
  const start = svg.indexOf(`data-cell-id="${escapeXmlAttr(cellId)}"`);
  if (start < 0) return null;
  const next = svg.indexOf('data-cell-id="', start + 14);
  const chunk = svg.slice(start, next < 0 ? undefined : next);
  const match = /\sstroke="(#[0-9a-f]{6})"/i.exec(chunk);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Chú giải màu dây: mỗi loại dây (`ims_cable_type_id`) có mặt trên bản vẽ một mục, màu ĐỌC TỪ ẢNH
 * đã lưu (màu người vẽ thấy lúc lưu — server không biết theme), tên do nơi gọi đưa. Loại không
 * có tên hoặc không đọc được màu thì bỏ: chú giải sai màu tệ hơn không có chú giải.
 */
export function cableLegend(index: CellIndex, svg: string, names: Map<string, string>): LegendItem[] {
  const out = new Map<string, LegendItem>();
  for (const cell of index.cells) {
    const typeId = cell.kind === 'edge' ? cell.ims.ims_cable_type_id : undefined;
    if (!typeId || out.has(typeId)) continue;
    const label = names.get(typeId);
    const color = label ? strokeOf(svg, cell.id) : null;
    if (label && color) out.set(typeId, { label, color });
  }
  return [...out.values()];
}

/** Tên file: tên bản vẽ + số phiên bản; ký tự cấm trong tên file thành "-". */
export function exportFileName(meta: ExportMeta, format: 'png' | 'pdf'): string {
  const name = (meta.path[meta.path.length - 1] ?? 'ban-ve').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim() || 'ban-ve';
  return `${name} - v${meta.seq}.${format}`;
}
