type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Vị thế của một lần lưu so với bản chính thức hiện hành. Mọi lần lưu chung MỘT dãy số, nên chỉ
 * cần số chính thức để biết: bằng nó là chính thức, lớn hơn (hoặc chưa phát hành lần nào) là
 * nháp, nhỏ hơn là bản cũ.
 */
export type DiagramVersionStanding = 'official' | 'draft' | 'older';

export function diagramVersionStanding(seq: number, officialSeq: number | null | undefined): DiagramVersionStanding {
  if (!officialSeq || seq > officialSeq) return 'draft';
  return seq === officialSeq ? 'official' : 'older';
}

/**
 * Nhãn phiên bản dùng ở mọi màn (bản đồ, thanh trình xem, trình sửa, hồ sơ thiết bị): MỘT ký hiệu
 * "#n" cho mọi lần lưu, kèm chữ vị thế ("#12 · Chính thức", "Nháp #13") — số không bao giờ tự nói
 * là chính thức (UX-E40). `short` bỏ chữ "Chính thức" khi trạng thái đã có chữ riêng bên cạnh.
 */
export function diagramVersionLabel(t: Translate, seq: number, officialSeq: number | null | undefined, form: 'long' | 'short' = 'long'): string {
  const standing = diagramVersionStanding(seq, officialSeq);
  if (standing === 'official') return t(form === 'short' ? 'diagramVersion.officialShort' : 'diagramVersion.official', { seq });
  return t(standing === 'draft' ? 'diagramVersion.draft' : 'diagramVersion.older', { seq });
}

/** Trạng thái của một bản vẽ trên cây (`GET /diagrams`). */
export type DiagramTreeStatus = 'empty' | 'draft' | 'official' | 'official_draft' | 'pending';

/**
 * Chữ trạng thái của một bản vẽ — bản đồ /diagrams và hồ sơ thiết bị nói cùng một câu: "#3 · Chính
 * thức" khi biết số bản chính thức, không thì nhãn trạng thái thường. Trạng thái luôn có CHỮ (Q-23).
 */
export function diagramStatusLabel(t: Translate, status: DiagramTreeStatus, officialSeq: number | null | undefined): string {
  if (officialSeq && status === 'official') return t('diagrams.status.officialSeq', { seq: officialSeq });
  if (officialSeq && status === 'official_draft') return t('diagrams.status.officialDraftSeq', { seq: officialSeq });
  return t(`diagrams.status.${status}`);
}
