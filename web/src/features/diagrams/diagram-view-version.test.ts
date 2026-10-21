import { describe, expect, it } from 'vitest';
import { viewVersionOf } from './diagram-view-version';

describe('Tab Xem mở phiên bản nào', () => {
  it.each([
    // Không chỉ định: có bản chính thức thì mở bản chính thức — người trực không đọc nhầm nháp.
    [{ mode: 'view', explicit: null, atDay: null, official: 'v-off' }, 'v-off'],
    // Chưa có bản chính thức: mở bản mới nhất (server tự chọn), màn tự xưng là nháp.
    [{ mode: 'view', explicit: null, atDay: null, official: null }, null],
    // Chỉ định rõ (Xem nháp #n, so sánh, phiên bản cũ) thì theo đúng chỉ định.
    [{ mode: 'view', explicit: 'v-draft', atDay: null, official: 'v-off' }, 'v-draft'],
    // Thanh trượt thời gian: `?at=` không kèm version nghĩa là ngày đó CHƯA có bản chính thức.
    [{ mode: 'view', explicit: null, atDay: '2026-01-01', official: 'v-off' }, null],
    // Tab Sửa luôn là bản mới nhất.
    [{ mode: 'edit', explicit: 'v-x', atDay: null, official: 'v-off' }, null],
  ] as const)('%j → %s', (input, expected) => {
    expect(viewVersionOf(input)).toBe(expected);
  });
});
