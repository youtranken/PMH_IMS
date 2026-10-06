import { describe, expect, it } from 'vitest';
import { clearAllDrafts, deleteDraft, draftKeyOf, loadDraft, memoryDraftBackend, saveDraft } from './draft-store';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
const OTHER_KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => 200 - i)));
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 6, 3, 0, 0);

describe('draft-store — bản vẽ dở cất ở trình duyệt, đã mã hoá (Q-23 06/10)', () => {
  it('cất rồi đọc lại đúng nội dung, giờ cất và phiên bản gốc', async () => {
    const backend = memoryDraftBackend();
    await saveDraft(backend, { id: draftKeyOf('u1', 'd1'), owner: 'u1', basedOn: 'v3', text: '<mxGraphModel>vẽ dở</mxGraphModel>', rawKey: KEY, now: T0 });
    const back = await loadDraft(backend, { id: draftKeyOf('u1', 'd1'), owner: 'u1', rawKey: KEY, keepHours: 24, now: T0 + HOUR });
    expect(back).toEqual({ value: { text: '<mxGraphModel>vẽ dở</mxGraphModel>', savedAt: T0, basedOn: 'v3' }, reason: null });
  });

  it('trên "đĩa" chỉ có bản mã — không thấy chữ nào của bản vẽ', async () => {
    const backend = memoryDraftBackend();
    await saveDraft(backend, { id: 'k', owner: 'u1', basedOn: null, text: 'SW-E2E-BI-MAT 10.0.0.9', rawKey: KEY, now: T0 });
    const stored = JSON.stringify([...backend.rows.values()].map((r) => ({ ...r, data: Array.from(new Uint8Array(r.data)) })));
    expect(stored).not.toContain('SW-E2E-BI-MAT');
    expect(stored).not.toContain('10.0.0.9');
  });

  it.each([
    ['quá hạn giữ → bỏ (xoá luôn)', { keepHours: 24, now: T0 + 25 * HOUR }, 'expired'],
    ['khoá khác (đổi master key / người khác) → không giải được, bỏ', { rawKey: OTHER_KEY }, 'undecryptable'],
    ['bản cất của người khác trên cùng máy → không trả', { owner: 'u2' }, 'none'],
  ])('%s', async (_name, over, reason) => {
    const backend = memoryDraftBackend();
    await saveDraft(backend, { id: 'k', owner: 'u1', basedOn: null, text: 'x', rawKey: KEY, now: T0 });
    const back = await loadDraft(backend, { id: 'k', owner: 'u1', rawKey: KEY, keepHours: 24, now: T0 + HOUR, ...over });
    expect(back).toEqual({ value: null, reason });
    if (reason !== 'none') expect(backend.rows.has('k')).toBe(false);
  });

  it('bản mã bê sang khoá ghi của bản vẽ khác → không giải được (gắn với đúng bản vẽ)', async () => {
    const backend = memoryDraftBackend();
    await saveDraft(backend, { id: 'u1:d1', owner: 'u1', basedOn: null, text: 'x', rawKey: KEY, now: T0 });
    backend.rows.set('u1:d2', { ...backend.rows.get('u1:d1')!, id: 'u1:d2' });
    expect((await loadDraft(backend, { id: 'u1:d2', owner: 'u1', rawKey: KEY, keepHours: 24, now: T0 })).reason).toBe('undecryptable');
  });

  it('không có gì → none; xoá một bản / xoá hết (đăng xuất)', async () => {
    const backend = memoryDraftBackend();
    expect(await loadDraft(backend, { id: 'k', owner: 'u1', rawKey: KEY, keepHours: 24, now: T0 })).toEqual({ value: null, reason: 'none' });
    await saveDraft(backend, { id: 'a', owner: 'u1', basedOn: null, text: 'x', rawKey: KEY, now: T0 });
    await saveDraft(backend, { id: 'b', owner: 'u1', basedOn: null, text: 'y', rawKey: KEY, now: T0 });
    await deleteDraft(backend, 'a');
    expect([...backend.rows.keys()]).toEqual(['b']);
    await clearAllDrafts(backend);
    expect(backend.rows.size).toBe(0);
  });

  it('kho của trình duyệt hỏng / bị chặn → không ném, coi như không có', async () => {
    const broken = {
      get: () => Promise.reject(new Error('blocked')),
      put: () => Promise.reject(new Error('blocked')),
      delete: () => Promise.reject(new Error('blocked')),
      clear: () => Promise.reject(new Error('blocked')),
    };
    await expect(saveDraft(broken, { id: 'k', owner: 'u1', basedOn: null, text: 'x', rawKey: KEY, now: T0 })).resolves.toBe(false);
    expect(await loadDraft(broken, { id: 'k', owner: 'u1', rawKey: KEY, keepHours: 24, now: T0 })).toEqual({ value: null, reason: 'unavailable' });
    await expect(clearAllDrafts(broken)).resolves.toBeUndefined();
  });
});
