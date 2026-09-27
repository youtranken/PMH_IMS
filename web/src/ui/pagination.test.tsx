import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { Pagination } from '@/ui/pagination';

describe('Pagination — dòng đếm không bao giờ vượt tổng', () => {
  it('trang đã vượt khoảng (tổng vừa co lại) thì hiện theo trang cuối', () => {
    renderWithI18n(<Pagination page={3} limit={20} total={40} onPageChange={vi.fn()} />);
    expect(screen.getByText(/21–40/)).toBeInTheDocument();
    expect(screen.queryByText(/41–40/)).not.toBeInTheDocument();
  });
});

describe('Pagination — nhảy thẳng tới trang', () => {
  it('bày dãy số trang có lược, trang hiện tại mang aria-current', () => {
    renderWithI18n(<Pagination page={5} limit={10} total={200} onPageChange={vi.fn()} />);
    const nav = screen.getByRole('navigation', { name: 'Trang' });
    for (const n of [1, 4, 5, 6, 20]) {
      expect(within(nav).getByRole('button', { name: `Trang ${n}` })).toBeInTheDocument();
    }
    expect(within(nav).queryByRole('button', { name: 'Trang 10' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Trang 5' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('button', { name: 'Trang 4' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('bấm một số trang thì chuyển tới đúng trang đó', async () => {
    const onPageChange = vi.fn();
    renderWithI18n(<Pagination page={5} limit={10} total={200} onPageChange={onPageChange} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Trang 20' }));
    expect(onPageChange).toHaveBeenCalledWith(20);
  });

  it('ô "Tới trang": gõ số rồi Enter; số vượt khoảng bị kẹp về trang cuối', async () => {
    const onPageChange = vi.fn();
    renderWithI18n(<Pagination page={1} limit={10} total={200} onPageChange={onPageChange} />);
    const user = userEvent.setup();
    const input = screen.getByRole('spinbutton', { name: 'Tới trang' });
    await user.type(input, '12{Enter}');
    expect(onPageChange).toHaveBeenLastCalledWith(12);
    await user.clear(input);
    await user.type(input, '999');
    await user.click(screen.getByRole('button', { name: 'Đi tới trang' }));
    expect(onPageChange).toHaveBeenLastCalledWith(20);
  });

  it('chỉ một trang thì không bày số trang, không bày ô "Tới trang"', () => {
    renderWithI18n(<Pagination page={1} limit={20} total={12} onPageChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Trang 1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Tới trang' })).not.toBeInTheDocument();
    // Hai nút ‹ › vẫn giữ nguyên — bài E2E "đúng bộ nút" của các màn đếm đúng chúng.
    expect(screen.getByRole('button', { name: 'Trang trước' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Trang sau' })).toBeDisabled();
  });

  it('ít trang (không có "…") thì có số trang nhưng không cần ô "Tới trang"', () => {
    renderWithI18n(<Pagination page={1} limit={10} total={30} onPageChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Trang 3' })).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Tới trang' })).not.toBeInTheDocument();
  });
});
