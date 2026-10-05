import type { VersionItem } from './diagram-api';

/** Một phiên bản của bản cha có thể chép sang bản vẽ con. */
export interface CopySource {
  id: string;
  seq: number;
  tag: 'official' | 'latest' | 'published' | 'named';
  label?: string | null;
  summary?: string;
  savedAt?: string;
}

/**
 * Phiên bản của bản cha cho "Nhân bản từ bản cha" (Q-23): bản chính thức đứng đầu (mặc định), rồi
 * bản mới nhất — hai bản này biết từ cây, không cần mã. Danh sách phiên bản là nội dung bản vẽ
 * (hỏi mã), nên chỉ khi đã tải mới thêm bản từng phát hành và bản đã đặt tên. Nháp vô danh ở giữa
 * không mời chọn: nó là bản vẽ dở mà lần lưu sau đã vẽ tiếp.
 */
export function copySources(
  parent: { officialVersionId?: string | null; officialSeq?: number | null; latestVersion?: { id: string; seq: number } | null },
  versions?: VersionItem[] | null,
  publishedIds: string[] = [],
): CopySource[] {
  const byId = new Map((versions ?? []).map((item) => [item.id, item]));
  const out: CopySource[] = [];
  const push = (id: string, seq: number, tag: CopySource['tag']) => {
    if (out.some((s) => s.id === id)) return;
    const item = byId.get(id);
    out.push({ id, seq, tag, ...(item ? { label: item.label, summary: item.summary, savedAt: item.savedAt } : {}) });
  };
  if (parent.officialVersionId && parent.officialSeq) push(parent.officialVersionId, parent.officialSeq, 'official');
  if (parent.latestVersion) push(parent.latestVersion.id, parent.latestVersion.seq, 'latest');
  const published = new Set(publishedIds);
  for (const item of [...(versions ?? [])].sort((a, b) => b.seq - a.seq)) {
    if (item.label) push(item.id, item.seq, 'named');
    else if (published.has(item.id)) push(item.id, item.seq, 'published');
  }
  return out;
}
