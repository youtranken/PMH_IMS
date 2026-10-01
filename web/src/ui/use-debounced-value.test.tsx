import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '@/ui/use-debounced-value';

// Ô tìm gõ tới đâu tìm tới đó nhưng không bắn một request mỗi phím: giá trị chỉ "lắng" sau một quãng yên.
describe('useDebouncedValue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('giữ giá trị cũ khi còn đang gõ, đổi sau khi yên đủ lâu', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
      initialProps: { value: 'a' },
    });
    expect(result.current).toBe('a');
    rerender({ value: 'ab' });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1));
    expect(result.current).toBe('a');
    rerender({ value: 'abc' });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1));
    expect(result.current).toBe('a');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe('abc');
  });

  it('nhận quãng chờ riêng', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 50), {
      initialProps: { value: 1 },
    });
    rerender({ value: 2 });
    act(() => vi.advanceTimersByTime(50));
    expect(result.current).toBe(2);
  });
});
