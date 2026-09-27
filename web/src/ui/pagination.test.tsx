import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen } from '@/test/test-utils';
import { Pagination } from '@/ui/pagination';

describe('Pagination — dòng đếm không bao giờ vượt tổng', () => {
  it('trang đã vượt khoảng (tổng vừa co lại) thì hiện theo trang cuối', () => {
    renderWithI18n(<Pagination page={3} limit={20} total={40} onPageChange={vi.fn()} />);
    expect(screen.getByText(/21–40/)).toBeInTheDocument();
    expect(screen.queryByText(/41–40/)).not.toBeInTheDocument();
  });
});
