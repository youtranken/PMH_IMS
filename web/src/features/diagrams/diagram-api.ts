import type { PortLink } from '@/lib/port-types';
import { diagramStatusLabel } from '@/ui/diagram-version';
import type { PresentationSource } from './diagram-presentation';

/** Hình dạng trả về của `api/v1/diagrams` (module `diagrams`, AD-18). */

export type DiagramNodeType = 'company' | 'site' | 'floor' | 'room' | 'cabinet' | 'other';
export const NODE_TYPES: DiagramNodeType[] = ['company', 'site', 'floor', 'room', 'cabinet', 'other'];

/** `pending` = có yêu cầu duyệt đang chờ (Q-23). */
export type DiagramStatus = 'empty' | 'draft' | 'official' | 'official_draft' | 'pending';

export interface DiagramNode {
  id: string;
  parentId: string | null;
  name: string;
  nodeType: DiagramNodeType;
  siteId: string | null;
  cabinetId: string | null;
  ownerEmail: string | null;
  /** Người tạo — Thành viên quản được bản trình bày mình tạo. Thiếu → coi như không phải của ai. */
  createdBy?: string;
  kind: 'official' | 'presentation';
  archivedAt: string | null;
  /** Ai lưu trữ — chỉ có ở khu "Đã lưu trữ". Thiếu → không hiện. */
  archivedBy?: string | null;
  archivedByName?: string | null;
  status: DiagramStatus;
  /** `savedByName` = tên người lưu cho thẻ "v12 · Thuận"; thiếu/`null` thì hiện email. */
  latestVersion: { id: string; seq: number; savedAt: string; savedBy: string; savedByName?: string | null } | null;
  /** Số phiên bản chính thức ("#3 · Chính thức"); `null` = chưa phát hành. Thiếu → coi như `null`. */
  officialSeq?: number | null;
  /** Phiên bản chính thức hiện hành — tab Xem mở đúng bản này. Thiếu → coi như `null`. */
  officialVersionId?: string | null;
  /** Yêu cầu duyệt đang chờ của bản vẽ. */
  pendingApprovalId?: string | null;
  /** Bản trình bày: chép từ đâu, bản gốc giờ chính thức ở phiên bản nào. Thiếu → coi như `null`. */
  source?: PresentationSource | null;
  /** Số mục lệch kho của bản chính thức hiện hành (Q-23); 0/thiếu = không hiện dấu. */
  driftCount?: number;
  /** Số phiên bản còn giữ — nút chuyển bản vẽ trong panel. Thiếu → coi như 0. */
  versionCount?: number;
  /** Lần lưu sau bản chính thức (chưa phát hành thì mọi lần lưu). Thiếu → coi như 0. */
  draftCount?: number;
  /** Số máy / dây đã khai / tủ trên lần lưu mới nhất — chỉ là số, xem không cần mã. Thiếu → không hiện. */
  stats?: { devices: number; cables: number; cabinets: number };
}

export interface VersionItem {
  id: string;
  seq: number;
  summary: string;
  /** Tóm tắt bỏ đuôi "lưu đè lên bản của …" (server tách); `overwrote` = tên người bị đè. Thiếu → dùng `summary`. */
  brief?: string;
  overwrote?: string | null;
  label: string | null;
  savedBy: string;
  savedByName: string | null;
  savedAt: string;
  basedOnVersionId: string | null;
  restoredFromSeq: number | null;
  /** Lượt lưu trùng y nguyên bản mới nhất: server không tạo phiên bản, trả lại bản mới nhất. */
  unchanged?: boolean;
}

/**
 * Một máy kho như sơ đồ thấy nó bây giờ (`GET /diagrams/device-info`, và kèm theo nội dung bản
 * vẽ). `found: false` = `ims_device_id` không còn trong kho. Không chứa gì của két (AD-18).
 */
export interface DiagramDeviceInfo {
  id: string;
  found: boolean;
  code: string | null;
  name: string | null;
  deviceTypeName: string | null;
  model: string | null;
  serial: string | null;
  status: string | null;
  ips: string[];
  siteCode: string | null;
  /** Tủ trong kho — màn sửa so với khung tủ máy được thả vào (vắng ở dữ liệu cũ). */
  cabinetId?: string | null;
  cabinetCode: string | null;
  /** U thấp nhất máy chiếm trong tủ (U1 = đáy) và số U. */
  u: number | null;
  uSize?: number | null;
  /** Có ảnh thật mặt trước / mặt sau không (ảnh riêng máy hoặc theo model). */
  photos?: { front: boolean; back: boolean };
  /** Cổng đang dùng / đã khai (dòng sơ đồ cổng hai chiều) — thẻ máy trên sơ đồ. Thiếu → 0/0. */
  ports?: { used: number; declared: number };
  vendorName: string | null;
  vendorPhone: string | null;
  warrantyEnd: string | null;
  /** Ô dựng sẵn cho lệnh chèn (style đã hydrate theo loại, nhãn ba dòng, rộng chuẩn, cao theo hình). */
  cell: { style: string; label: string; width: number; height: number; attrs?: Record<string, string> };
  /** Nhãn một dòng khi máy nằm trong khung tủ (vắng ở server cũ). */
  rackLabel?: string;
}

/**
 * Một dòng sơ đồ cổng như sơ đồ thấy nó (`id` = `ims_link_id`). Nhãn cổng hai chiều + style ô dây
 * do server dựng — web chèn nét bằng đúng luật hydrate, không tự ghép chuỗi.
 */
export interface DiagramLink extends PortLink {
  colorSlot: number | null;
  /** Nhãn khi nét đi từ máy giữ bản ghi (`deviceId`) / từ máy đầu kia. */
  labelFromA: string;
  labelFromB: string;
  edgeStyle: string;
  /** Hai ô nhãn cổng ở đầu dây chèn kèm nét mới (Q-23): style theo loại dây + chỗ đặt trên nét. */
  endLabel: { style: string; offset: number };
}

export type CableEdgeState = 'linked' | 'removed' | 'mismatch' | 'duplicate' | 'undeclared';

/** Nét dây "của kho" và trạng thái — luật ở `api/src/modules/diagrams/diagram-checks.ts`. */
export interface CableEdge {
  cellId: string;
  linkId: string | null;
  state: CableEdgeState;
  sourceDeviceId: string | null;
  targetDeviceId: string | null;
}

export interface CableTypeInfo {
  id: string;
  name: string;
  colorSlot: number;
  active: boolean;
}

export interface DiagramContent {
  diagram: DiagramNode;
  /**
   * Khoá AES (base64) mã bản vẽ dở trước khi cất ở trình duyệt — chỉ có ở nội dung tab Sửa, tức sau
   * khi nhập mã sơ đồ (Q-23). Thiếu → không cất bản dở.
   */
  draftKey?: string;
  version: (VersionItem & { xml: string; svg: string | null }) | null;
  /** Ô thiết bị của phiên bản (id ô → id máy + mã ghi trên ô). Thiếu → coi như rỗng. */
  deviceCells?: { cellId: string; deviceId: string; code: string }[];
  devices?: DiagramDeviceInfo[];
  /** Dây của kho (vắng ở dữ liệu giả của bài kiểm cũ — coi như rỗng). */
  cableEdges?: CableEdge[];
  links?: DiagramLink[];
  undrawnLinkIds?: string[];
  externalLinkIds?: string[];
  cableTypes?: CableTypeInfo[];
  /** Khung mang bản vẽ con / dải IP / tủ (AD-18). Thiếu → coi như rỗng. */
  frames?: DiagramFrame[];
  /** Lệch kho của phiên bản đang mở so với kho hiện tại (Q-23) — chỉ báo, không sửa. */
  drift?: Finding[];
  /** Lớp draw.io theo thứ tự trong XML (`name: ''` = lớp mặc định không tên). Thiếu → coi như rỗng. */
  layers?: { id: string; name: string }[];
  /** Mọi ô của phiên bản (chỉ mục ô): lớp + khung bao mô hình. Thiếu → coi như rỗng. */
  cells?: {
    id: string;
    kind: 'device' | 'edge' | 'shape';
    layer: string | null;
    bounds: { x: number; y: number; width: number; height: number } | null;
    /** Mã máy / nhãn (`null` = ô không có chữ) — tên ô trong hộp ghim bình luận. */
    label?: string | null;
  }[];
}

/** Bản vẽ chỉ tên + id (thông tin của cây). */
export interface DiagramRef {
  id: string;
  name: string;
}

/** `GET /diagrams/find?q=` — máy khớp mã/tên/IP + bản vẽ chính thức chứa nó. */
export interface FoundDevice {
  id: string;
  code: string;
  name: string | null;
  diagrams: DiagramRef[];
}

/** `GET /diagrams/path?from=&to=` — đường ít dây nhất trên sơ đồ cổng; `path: null` = không có. */
export interface PathResult {
  from: { id: string; code: string };
  to: { id: string; code: string };
  path: { hops: { deviceId: string; code: string; diagrams: DiagramRef[] }[]; linkIds: string[] } | null;
}

/**
 * Một khung của phiên bản (`api/src/modules/diagrams/diagram-frames.ts`). `child` = bản vẽ con
 * lúc mở (kể cả đã lưu trữ); `null` khi id trỏ bản vẽ không còn.
 */
export interface DiagramFrame {
  cellId: string;
  label: string;
  childDiagramId: string | null;
  subnetId: string | null;
  cabinetId: string | null;
  child: { id: string; name: string; archived: boolean; kind: 'official' | 'presentation' } | null;
}

/** `GET /diagrams/subnet-info/:id` — thẻ khung VLAN. */
export interface SubnetSummary {
  id: string;
  name: string;
  cidr: string;
  vlan: number | null;
  siteCode: string | null;
  gateway: string | null;
  voided: boolean;
  total: number;
  used: number;
  free: number;
  firstFree: string[];
}

export const subnetInfoKey = (id: string) => ['diagram-subnet-info', id] as const;

export const deviceInfoKey = (ids: string[]) => ['diagram-device-info', ...ids] as const;
export const byDeviceKey = (deviceId: string) => ['diagrams-by-device', deviceId] as const;

export interface DiffItem {
  id: string;
  label: string;
}

export interface GroupDiff {
  added: DiffItem[];
  removed: DiffItem[];
  changed: DiffItem[];
}

export interface CellDiff {
  devices: GroupDiff;
  edges: GroupDiff;
  shapes: GroupDiff;
}

export interface DiagramHistoryRow {
  id: string;
  action: string;
  actor: string;
  actorName: string | null;
  changes: Record<string, unknown> | null;
  createdAt: string;
}

export interface EditorSettings {
  initTimeoutSeconds: number;
  presenceTtlSeconds: number;
  /** `diagram.xml_max_kb` — trần cỡ ảnh tự do nhúng vào bản trình bày. Thiếu → không chặn sớm. */
  xmlMaxKb?: number;
  /** `diagram.draft_keep_hours` — bản vẽ dở cất ở trình duyệt quá ngần này giờ thì bỏ. Thiếu → 24. */
  draftKeepHours?: number;
  /** `diagram.device_width_px` — bề rộng chuẩn của ô thiết bị trên trang tự do. */
  deviceWidthPx?: number;
  /** Cột "Chưa khai U" để dựng khi Hủy khai U mà trang chưa có cột của tủ (vắng ở server cũ). */
  rackColumn?: { style: string; width: number; top: number; bottom: number; gap: number };
}

/*
 * Khoá query tách gốc theo loại: làm mới cây/phiên bản sau một lượt lưu KHÔNG được kéo theo nội
 * dung đang mở trong trình vẽ — nạp lại nó là xoá lịch sử hoàn tác của người vẽ, và mỗi lần tải
 * nội dung là một dòng `diagram.viewed` trong nhật ký.
 */
export const TREE_KEY = ['diagrams'] as const;
export const nodeKey = (id: string) => ['diagram-node', id] as const;
export const contentKey = (id: string, mode: string, versionId: string | null) => ['diagram-content', id, mode, versionId] as const;
export const versionsKey = (id: string) => ['diagram-versions', id] as const;
export const historyKey = (id: string) => ['diagram-history', id] as const;
export const SETTINGS_KEY = ['diagram-editor-settings'] as const;

/** Khoá nhãn viết đủ (không ghép chuỗi) để bài điểm danh khoá dịch thấy chỗ dùng. */
export const NODE_TYPE_KEY: Record<DiagramNodeType, string> = {
  company: 'diagrams.nodeType.company',
  site: 'diagrams.nodeType.site',
  floor: 'diagrams.nodeType.floor',
  room: 'diagrams.nodeType.room',
  cabinet: 'diagrams.nodeType.cabinet',
  other: 'diagrams.nodeType.other',
};

export const STATUS_KEY: Record<DiagramStatus, string> = {
  empty: 'diagrams.status.empty',
  draft: 'diagrams.status.draft',
  official: 'diagrams.status.official',
  official_draft: 'diagrams.status.official_draft',
  pending: 'diagrams.status.pending',
};

/** "#3 · Chính thức" khi biết số phiên bản chính thức (Q-23); không thì nhãn trạng thái thường. */
export function statusLabel(node: DiagramNode, t: (key: string, options?: Record<string, unknown>) => string): string {
  return diagramStatusLabel(t, node.status, node.officialSeq);
}

/** Một lời báo của tự kiểm (AD-18): đỏ chặn, vàng cho qua; `cellId` để bay tới ô. */
export interface Finding {
  level: 'error' | 'warning';
  code: string;
  cellId: string | null;
  message: string;
}

export interface ApprovalInfo {
  id: string;
  state: string;
  requester: string;
  requesterName: string;
  reason: string;
  createdAt: string;
}

/** `GET /diagrams/:id/review` — trang duyệt: một dòng tóm tắt + cảnh báo (Q-23). */
export interface ReviewPage {
  approval: ApprovalInfo | null;
  versionId: string | null;
  seq: number | null;
  officialSeq: number | null;
  /** Bản chính thức hiện hành — nút so sánh trên trang duyệt. Thiếu → coi như `null`. */
  officialVersionId?: string | null;
  summary: string | null;
  errors: Finding[];
  warnings: Finding[];
}

export interface CommentAnchor {
  x: number;
  y: number;
}

export interface CommentRow {
  id: string;
  versionId: string;
  approvalId: string | null;
  parentId: string | null;
  kind: 'note' | 'resolved' | 'reopened';
  cellId: string | null;
  anchor: CommentAnchor | null;
  body: string | null;
  author: string;
  authorName: string | null;
  createdAt: string;
}

/** Một luồng ghim: hàng gốc + trả lời; "Đã xử lý" là hàng sự kiện phía server. */
export interface CommentThread extends CommentRow {
  versionSeq: number | null;
  /** Loại ô ghim trong phiên bản của ghim; `null` = ghi chú chung hoặc ô không còn trong phiên bản đó. */
  cellKind?: 'device' | 'edge' | 'shape' | null;
  /** Mã máy / nhãn của ô ghim; `null` khi ô không có chữ. */
  cellLabel?: string | null;
  resolved: boolean;
  replies: CommentRow[];
}

export interface Publications {
  officialVersionId: string | null;
  publishedVersionIds: string[];
}

/** `GET /diagrams/:id/compare?from=&to=` — tô màu theo ô trên ảnh xem của bản `to`. */
export interface CompareView {
  from: { id: string; seq: number };
  to: { id: string; seq: number; savedAt: string; svg: string | null };
  result: {
    added: { id: string; label: string }[];
    removed: { id: string; label: string; bounds: { x: number; y: number; width: number; height: number } | null }[];
    changed: { id: string; label: string; reasons: string[] }[];
    anchors: { id: string; bounds: { x: number; y: number; width: number; height: number } }[];
  };
  counts: { added: number; removed: number; changed: number };
}

export const compareKey = (id: string, from: string, to: string) => ['diagram-compare', id, from, to] as const;

export const reviewKey = (id: string) => ['diagram-review', id] as const;
export const commentsKey = (id: string) => ['diagram-comments', id] as const;
export const publicationsKey = (id: string) => ['diagram-publications', id] as const;
