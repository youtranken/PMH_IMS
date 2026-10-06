import type { CellIndex, IndexedCell } from './diagram-cells';

/**
 * Bản trình bày (Q-23, FR-045) — hàm THUẦN, test bảng dữ liệu ở `diagram-presentation.spec.ts`.
 *
 * Bản trình bày là một hàng `diagram` riêng (`kind = 'presentation'`) chép XML của một phiên bản
 * chính thức: không duyệt, không phát hành, được thêm thiết bị dự kiến và ảnh tự do. Thiết bị dự
 * kiến không có trong kho nên không bao giờ được lọt vào bản chính thức — cổng lưu và tự kiểm
 * cùng đọc `isPlannedCell` dưới đây.
 */

/** Dòng chữ của dải — màn xem và file xuất dùng đúng một câu. */
export const PRESENTATION_BAND = 'BẢN TRÌNH BÀY — không phải sơ đồ chính thức';

const PLANNED_ATTR = 'ims_planned';

/**
 * Ô thiết bị dự kiến. Mọi khoá `ims_planned*` đều tính, bất kể giá trị: XML là dữ liệu không tin
 * cậy (AD-17), một `ims_planned="0"` hay chỉ `ims_planned_price` gửi thẳng qua API không được là
 * đường lách vào bản chính thức.
 */
export function isPlannedCell(cell: IndexedCell): boolean {
  return Object.keys(cell.ims).some((key) => key === PLANNED_ATTR || key.startsWith(`${PLANNED_ATTR}_`));
}

/** Câu từ chối khi lưu ô dự kiến vào bản không phải trình bày; `null` = nhận. */
export function plannedNotAllowedReason(index: CellIndex, kind: 'official' | 'presentation'): string | null {
  if (kind === 'presentation') return null;
  const hit = index.cells.find(isPlannedCell);
  if (!hit) return null;
  return `Ô ${hit.id} là thiết bị dự kiến — chỉ bản trình bày được có thiết bị dự kiến, bản chính thức chỉ vẽ máy có trong kho.`;
}

/** Bản trình bày được chép từ đâu, và bản gốc giờ chính thức ở phiên bản nào. */
export interface PresentationSource {
  diagramId: string | null;
  name: string | null;
  /** Phiên bản đã chép — `null` khi hàng nguồn đã bị dọn. */
  versionId: string | null;
  seq: number | null;
  officialVersionId: string | null;
  officialSeq: number | null;
}

/**
 * Số phiên bản chính thức mới của bản gốc nếu nó đã đổi sau lúc chép; `null` = không báo. So id
 * chứ không chỉ so số: "khôi phục làm chính thức" tạo phiên bản số lớn hơn mà nội dung cũ — vẫn
 * là bản chính thức khác bản đã chép, người trình bày cần biết.
 */
export function newerOfficialSeq(source: PresentationSource | null): number | null {
  if (!source || source.seq === null || source.officialSeq === null || !source.officialVersionId) return null;
  if (source.officialVersionId === source.versionId) return null;
  return source.officialSeq > source.seq ? source.officialSeq : null;
}

/**
 * Dải "BẢN TRÌNH BÀY" + dòng "Dựa trên bản chính thức phiên bản N" — màn xem hiện ngay, file
 * xuất (PNG/PDF) ghép cùng hai dòng này. `null` = bản không phải trình bày.
 */
export function presentationBand(diagram: {
  kind: 'official' | 'presentation';
  source: { seq: number | null } | null;
}): { title: string; basedOn: string | null } | null {
  if (diagram.kind !== 'presentation') return null;
  const seq = diagram.source?.seq ?? null;
  return { title: PRESENTATION_BAND, basedOn: seq === null ? null : `Dựa trên bản chính thức phiên bản ${seq}` };
}

const NAME_MAX = 120;

/** Tên mặc định của bản trình bày; lần thử thứ `attempt` > 1 thêm số để tránh tên anh em trùng. */
export function presentationName(sourceName: string, attempt: number): string {
  const suffix = attempt > 1 ? ` — trình bày (${attempt})` : ' — trình bày';
  return `${sourceName.trim().slice(0, NAME_MAX - suffix.length)}${suffix}`;
}

/**
 * Ai đổi tên / lưu trữ được bản vẽ: Admin/SA mọi bản; Thành viên chỉ bản trình bày mình tạo hoặc
 * đang phụ trách. Bản trình bày là bản nháp riêng để xin mua sắm, không qua duyệt (Q-23), nên
 * chủ của nó tự dọn được; bản chính thức là hồ sơ chung, giữ cho Admin/SA.
 */
export function canManageNode(
  node: { kind: 'official' | 'presentation'; ownerEmail: string | null; createdBy: string },
  actor: { email: string; role: 'sa' | 'admin' | 'member' },
): boolean {
  if (actor.role === 'sa' || actor.role === 'admin') return true;
  if (node.kind !== 'presentation') return false;
  const me = actor.email.toLowerCase();
  return node.createdBy.toLowerCase() === me || (node.ownerEmail ?? '').toLowerCase() === me;
}
