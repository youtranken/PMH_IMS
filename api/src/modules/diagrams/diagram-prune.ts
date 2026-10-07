/**
 * "Bỏ bản nháp" (Q-23) — hàm THUẦN chọn phiên bản sẽ xoá, test bảng dữ liệu ở `diagram-prune.spec.ts`.
 * Trigger `diagram_prune_guard` (0056) vẫn là lưới cuối: hàm này sai thì DB từ chối, không mất hồ sơ.
 */

export interface PruneVersion {
  id: string;
  seq: number;
  basedOnVersionId: string | null;
  restoredFromVersionId: string | null;
  /** Tên mới nhất khác `null`. */
  named: boolean;
  /** Từng có dòng `version.published`. */
  published: boolean;
}

export interface DraftPlan {
  /** Mốc giữ: bản chính thức, hoặc phiên bản đầu tiên khi chưa có bản chính thức. `null` = chưa lưu lần nào. */
  keepSeq: number | null;
  /** Phiên bản sẽ xoá, theo `seq` tăng dần. */
  discard: PruneVersion[];
  /** Bản nháp TRONG dải chọn phải giữ vì đã đặt tên hoặc vì một phiên bản giữ lại trỏ tới nó. */
  keptDrafts: number;
  /** Số bắt đầu không nằm SAU mốc giữ — người gọi từ chối, không bỏ gì. */
  fromInvalid?: boolean;
}

/**
 * Bản nháp = phiên bản có số SAU mốc giữ, chưa đặt tên, chưa từng phát hành. Phiên bản giữ lại mà
 * trỏ tới một bản nháp (`based_on` / khôi phục từ) kéo bản nháp đó vào nhóm giữ — lặp tới khi
 * đứng yên, vì bản vừa được giữ có thể lại trỏ tới một bản nháp khác (chuỗi khôi phục).
 *
 * `fromSeq` = chỉ bỏ từ số này trở về sau. Không có kiểu "xoá một bản ở giữa": các lần lưu sau
 * vẽ tiếp trên nó, nên dải luôn là ĐUÔI (Q-23).
 */
export function planDraftDiscard(versions: PruneVersion[], officialVersionId: string | null, fromSeq?: number): DraftPlan {
  if (versions.length === 0) return { keepSeq: null, discard: [], keptDrafts: 0 };
  const official = officialVersionId ? versions.find((v) => v.id === officialVersionId) : undefined;
  const keepSeq = official ? official.seq : Math.min(...versions.map((v) => v.seq));
  if (fromSeq !== undefined && (!Number.isInteger(fromSeq) || fromSeq <= keepSeq)) {
    return { keepSeq, discard: [], keptDrafts: 0, fromInvalid: true };
  }
  const after = versions.filter((v) => v.seq > keepSeq && (fromSeq === undefined || v.seq >= fromSeq));
  const doomed = new Set(after.filter((v) => !v.named && !v.published).map((v) => v.id));
  for (let changed = true; changed; ) {
    changed = false;
    for (const version of versions) {
      if (doomed.has(version.id)) continue;
      for (const ref of [version.basedOnVersionId, version.restoredFromVersionId]) {
        if (ref && doomed.delete(ref)) changed = true;
      }
    }
  }
  const discard = after.filter((v) => doomed.has(v.id)).sort((a, b) => a.seq - b.seq);
  return { keepSeq, discard, keptDrafts: after.length - discard.length };
}

export interface CollapsePlan {
  /** Bản nháp sẽ xoá (kể cả bản được chọn — nội dung của nó ghi lại thành lần lưu mới), theo `seq`. */
  discard: PruneVersion[];
  /** Số của lần lưu gộp: sau mọi bản còn giữ, không còn bản nào thì 1. */
  nextSeq: number;
  /**
   * Không gộp được: `missing` không có bản đó; `not-draft` bản đó đã đặt tên / phát hành / chính thức
   * (vốn đã giữ); `pinned` một bản giữ lại trỏ tới nó; `alone` nó đã là bản nháp duy nhất.
   */
  refused: 'missing' | 'not-draft' | 'pinned' | 'alone' | null;
}

/**
 * "Chỉ giữ bản này" (Q-26 07/10): xoá MỌI bản nháp (chưa đặt tên, chưa phát hành, không phải bản chính
 * thức — kể cả bản đầu tiên) và ghi nội dung bản được chọn thành một lần lưu mới. Bản giữ lại trỏ tới
 * bản nháp nào (`based_on` / khôi phục từ) thì bản nháp đó cũng được giữ, như "Bỏ bản nháp" — khoá ngoại
 * và chuỗi lịch sử không hụt khúc. Lần lưu mới không trỏ về bản nào đã xoá.
 */
export function planCollapse(versions: PruneVersion[], officialVersionId: string | null, keepId: string): CollapsePlan {
  const none = (refused: CollapsePlan['refused']): CollapsePlan => ({ discard: [], nextSeq: 0, refused });
  const target = versions.find((v) => v.id === keepId);
  if (!target) return none('missing');
  const kept = (v: PruneVersion) => v.named || v.published || v.id === officialVersionId;
  if (kept(target)) return none('not-draft');
  const doomed = new Set(versions.filter((v) => !kept(v)).map((v) => v.id));
  for (let changed = true; changed; ) {
    changed = false;
    for (const version of versions) {
      if (doomed.has(version.id)) continue;
      for (const ref of [version.basedOnVersionId, version.restoredFromVersionId]) {
        if (ref && doomed.delete(ref)) changed = true;
      }
    }
  }
  if (!doomed.has(target.id)) return none('pinned');
  if (doomed.size === 1) return none('alone');
  const discard = versions.filter((v) => doomed.has(v.id)).sort((a, b) => a.seq - b.seq);
  const remaining = versions.filter((v) => !doomed.has(v.id)).map((v) => v.seq);
  return { discard, nextSeq: remaining.length > 0 ? Math.max(...remaining) + 1 : 1, refused: null };
}

/** "#13–#17" / "#13" / "#13, #15–#16" — dòng lịch sử nói xoá những số nào, gọn khi liền nhau. */
export function seqRanges(seqs: number[]): string {
  const sorted = [...new Set(seqs)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    parts.push(i === j ? `#${sorted[i]}` : `#${sorted[i]}–#${sorted[j]}`);
    i = j + 1;
  }
  return parts.join(', ');
}
