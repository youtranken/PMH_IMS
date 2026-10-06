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
