/** Hình dạng trả về của `api/v1/diagrams` (module `diagrams`, AD-18). */

export type DiagramNodeType = 'company' | 'site' | 'floor' | 'room' | 'cabinet' | 'other';
export const NODE_TYPES: DiagramNodeType[] = ['company', 'site', 'floor', 'room', 'cabinet', 'other'];

export type DiagramStatus = 'empty' | 'draft' | 'official' | 'official_draft';

export interface DiagramNode {
  id: string;
  parentId: string | null;
  name: string;
  nodeType: DiagramNodeType;
  siteId: string | null;
  cabinetId: string | null;
  ownerEmail: string | null;
  kind: 'official' | 'presentation';
  archivedAt: string | null;
  status: DiagramStatus;
  latestVersion: { id: string; seq: number; savedAt: string; savedBy: string } | null;
}

export interface VersionItem {
  id: string;
  seq: number;
  summary: string;
  label: string | null;
  savedBy: string;
  savedByName: string | null;
  savedAt: string;
  basedOnVersionId: string | null;
  restoredFromSeq: number | null;
}

export interface DiagramContent {
  diagram: DiagramNode;
  version: (VersionItem & { xml: string; svg: string | null }) | null;
}

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
};
