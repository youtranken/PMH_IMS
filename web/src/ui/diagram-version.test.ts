import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { diagramStatusLabel, diagramVersionLabel, diagramVersionStanding } from './diagram-version';

const t = i18n.t.bind(i18n) as (key: string, options?: Record<string, unknown>) => string;

describe('Nhãn phiên bản bản vẽ — một cách gọi ở mọi nơi', () => {
  it.each([
    // seq, officialSeq, vị thế
    [2, null, 'draft'],
    [2, undefined, 'draft'],
    [3, 3, 'official'],
    [5, 3, 'draft'],
    [2, 3, 'older'],
  ] as const)('phiên bản %s, chính thức %s → %s', (seq, officialSeq, standing) => {
    expect(diagramVersionStanding(seq, officialSeq)).toBe(standing);
  });

  it.each([
    // MỘT ký hiệu "#n" cho mọi lần lưu, chữ vị thế đi kèm (UX-E40).
    [2, null, 'long', 'Nháp #2'],
    [3, 3, 'long', '#3 · Chính thức'],
    [3, 3, 'short', '#3'],
    [5, 3, 'short', 'Nháp #5'],
    [2, 3, 'long', 'Phiên bản #2'],
  ] as const)('phiên bản %s, chính thức %s, dạng %s → "%s"', (seq, officialSeq, form, text) => {
    expect(diagramVersionLabel(t, seq, officialSeq, form)).toBe(text);
  });

  it.each([
    ['official', 3, '#3 · Chính thức'],
    ['official_draft', 3, '#3 · Chính thức · có bản nháp'],
    ['draft', null, 'Bản nháp'],
    ['pending', null, 'Chờ duyệt'],
    ['empty', null, 'Chưa vẽ'],
  ] as const)('trạng thái %s (chính thức %s) → "%s"', (status, officialSeq, text) => {
    expect(diagramStatusLabel(t, status, officialSeq)).toBe(text);
  });
});
