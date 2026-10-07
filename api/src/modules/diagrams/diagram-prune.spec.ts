import { planCollapse, planDraftDiscard, seqRanges, type PruneVersion } from './diagram-prune';

function v(seq: number, extra: Partial<PruneVersion> = {}): PruneVersion {
  return { id: `v${seq}`, seq, basedOnVersionId: null, restoredFromVersionId: null, named: false, published: false, ...extra };
}

const ids = (plan: { discard: PruneVersion[] }) => plan.discard.map((x) => x.id);

describe('planDraftDiscard — chọn bản nháp để bỏ (Q-23)', () => {
  it.each([
    ['chưa lưu lần nào', [], null, [], null],
    ['bản chính thức là mới nhất — không có gì để bỏ', [v(1), v(2)], 'v2', [], 2],
    ['bỏ mọi lần lưu sau bản chính thức', [v(1), v(2), v(3), v(4)], 'v2', ['v3', 'v4'], 2],
    ['chưa có bản chính thức — giữ phiên bản đầu', [v(1), v(2), v(3)], null, ['v2', 'v3'], 1],
    ['bản đã đặt tên sau bản chính thức được giữ', [v(1), v(2), v(3, { named: true }), v(4)], 'v1', ['v2', 'v4'], 1],
    ['bản từng phát hành được giữ', [v(1), v(2, { published: true }), v(3)], 'v1', ['v3'], 1],
  ] as const)('%s', (_name, versions, official, expected, keepSeq) => {
    const plan = planDraftDiscard([...versions], official);
    expect(ids(plan)).toEqual(expected);
    expect(plan.keepSeq).toBe(keepSeq);
  });

  it('bản giữ lại trỏ tới bản nháp (based_on) → bản nháp đó cũng giữ', () => {
    const plan = planDraftDiscard([v(1), v(2), v(3, { named: true, basedOnVersionId: 'v2' }), v(4)], 'v1');
    expect(ids(plan)).toEqual(['v4']);
    expect(plan.keptDrafts).toBe(2);
  });

  it('chuỗi: bản đặt tên khôi phục từ #3, #3 dựa trên #2 → giữ cả chuỗi', () => {
    const versions = [v(1), v(2), v(3, { basedOnVersionId: 'v2' }), v(4, { named: true, restoredFromVersionId: 'v3' }), v(5)];
    expect(ids(planDraftDiscard(versions, 'v1'))).toEqual(['v5']);
  });

  it('bản nháp trỏ tới bản nháp khác cùng bị bỏ — không kéo gì lại', () => {
    const versions = [v(1), v(2, { basedOnVersionId: 'v1' }), v(3, { basedOnVersionId: 'v2' })];
    expect(ids(planDraftDiscard(versions, 'v1'))).toEqual(['v2', 'v3']);
  });

  it('trả theo số tăng dần dù đầu vào lộn xộn', () => {
    expect(ids(planDraftDiscard([v(4), v(1), v(3), v(2)], 'v1'))).toEqual(['v2', 'v3', 'v4']);
  });
});

describe('planDraftDiscard — bỏ nháp TỪ một bản chọn trở về sau (Q-23)', () => {
  it.each([
    ['từ #3: giữ #2, bỏ #3–#4', [v(1), v(2), v(3), v(4)], 'v1', 3, ['v3', 'v4']],
    ['từ bản nháp đầu = bỏ hết như mặc định', [v(1), v(2), v(3)], 'v1', 2, ['v2', 'v3']],
    ['từ bản mới nhất: chỉ bỏ bản đó', [v(1), v(2), v(3)], 'v1', 3, ['v3']],
    ['bản đặt tên trong dải vẫn giữ', [v(1), v(2), v(3, { named: true }), v(4)], 'v1', 2, ['v2', 'v4']],
    ['số lớn hơn mọi phiên bản: không bỏ gì', [v(1), v(2)], 'v1', 9, []],
    ['chưa có bản chính thức: từ #3 giữ #1–#2', [v(1), v(2), v(3)], null, 3, ['v3']],
  ] as const)('%s', (_name, versions, official, fromSeq, expected) => {
    expect(ids(planDraftDiscard([...versions], official, fromSeq))).toEqual(expected);
  });

  it('bản đặt tên SAU dải trỏ vào bản nháp trong dải → bản nháp đó giữ', () => {
    const plan = planDraftDiscard([v(1), v(2), v(3), v(4, { named: true, basedOnVersionId: 'v3' }), v(5)], 'v1', 3);
    expect(ids(plan)).toEqual(['v5']);
    expect(plan.keptDrafts).toBe(2);
  });

  it('bản nháp TRƯỚC dải không tính vào "giữ lại" — người dùng không chọn chúng', () => {
    expect(planDraftDiscard([v(1), v(2), v(3), v(4)], 'v1', 4).keptDrafts).toBe(0);
  });

  it.each([
    ['bằng mốc giữ', 2],
    ['trước mốc giữ', 1],
    ['không phải số nguyên dương', 0],
  ])('số bắt đầu %s → cờ fromInvalid, không bỏ gì', (_name, fromSeq) => {
    const plan = planDraftDiscard([v(1), v(2), v(3)], 'v2', fromSeq);
    expect(plan.fromInvalid).toBe(true);
    expect(plan.discard).toEqual([]);
  });
});

describe('seqRanges', () => {
  it.each([
    [[13], '#13'],
    [[13, 14, 15, 16, 17], '#13–#17'],
    [[17, 13, 15, 16], '#13, #15–#17'],
    [[], ''],
  ])('%j → %s', (seqs, text) => {
    expect(seqRanges(seqs)).toBe(text);
  });
});

describe('planCollapse — "Chỉ giữ bản này": gộp mọi bản nháp về MỘT bản (Q-26 07/10)', () => {
  const ver = (seq: number, over: Partial<{ named: boolean; published: boolean; basedOn: string | null; restoredFrom: string | null }> = {}) => ({
    id: `v${seq}`,
    seq,
    basedOnVersionId: over.basedOn === undefined ? (seq > 1 ? `v${seq - 1}` : null) : over.basedOn,
    restoredFromVersionId: over.restoredFrom ?? null,
    named: over.named ?? false,
    published: over.published ?? false,
  });
  it.each([
    {
      name: 'chưa phát hành: giữ #6 → xoá #1–#6, bản gộp thành #1',
      versions: [1, 2, 3, 4, 5, 6].map((n) => ver(n)),
      official: null,
      keep: 'v6',
      discard: [1, 2, 3, 4, 5, 6],
      nextSeq: 1,
      refused: null,
    },
    {
      name: 'có bản chính thức #2 + bản đặt tên #4 (trỏ về #3): giữ #2, #3, #4; bản gộp nhận số sau #4',
      versions: [ver(1), ver(2, { published: true }), ver(3), ver(4, { named: true }), ver(5), ver(6)],
      official: 'v2',
      keep: 'v6',
      discard: [5, 6],
      nextSeq: 5,
      refused: null,
    },
    { name: 'bản chọn đã đặt tên → không phải bản nháp', versions: [ver(1), ver(2, { named: true })], official: null, keep: 'v2', discard: [], nextSeq: 0, refused: 'not-draft' },
    {
      name: 'bản chọn bị một bản đặt tên trỏ tới → không gộp được',
      versions: [ver(1), ver(2), ver(3, { named: true })],
      official: null,
      keep: 'v2',
      discard: [],
      nextSeq: 0,
      refused: 'pinned',
    },
    { name: 'chỉ còn đúng bản đó là nháp → không có gì để gộp', versions: [ver(1, { published: true }), ver(2)], official: 'v1', keep: 'v2', discard: [], nextSeq: 0, refused: 'alone' },
    { name: 'id lạ', versions: [ver(1)], official: null, keep: 'x', discard: [], nextSeq: 0, refused: 'missing' },
  ])('$name', ({ versions, official, keep, discard, nextSeq, refused }) => {
    const plan = planCollapse(versions, official, keep);
    expect(plan.refused).toBe(refused);
    expect(plan.discard.map((v) => v.seq)).toEqual(discard);
    if (!refused) expect(plan.nextSeq).toBe(nextSeq);
  });
});
