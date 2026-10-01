import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import vi_ from '@/locales/vi';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { DetailHeader } from '@/ui/detail-header';
import { Dialog } from '@/ui/dialog';
import { CheckIcon, CloseIcon, CopyIcon, KebabIcon } from '@/ui/glyph-icons';
import { CopyButton } from '@/ui/copy-button';
import { RowActions } from '@/ui/row-actions';

/*
 * Ký tự `›` `✕` `⋮` `→` theo cỡ chữ: ở 14px mảnh như dấu ngoặc, lệch khỏi tâm ô bấm, và đứng
 * cạnh SVG thì trông như hai hệ thống. Mọi hình nhỏ trên nút đều là SVG dùng chung.
 */
describe('Hình nhỏ trên nút là SVG, không phải ký tự', () => {
  it('CloseIcon và KebabIcon là SVG aria-hidden, không chữ', () => {
    const { container } = renderWithI18n(
      <>
        <CloseIcon />
        <KebabIcon />
      </>,
    );
    const svgs = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(svgs).toHaveLength(2);
    expect(container.textContent).toBe('');
  });

  it('nút ba chấm vẽ SVG, tên vẫn là nhãn', () => {
    renderWithI18n(
      <RowActions label="Thao tác với LIC-01" items={[{ key: 'x', label: 'Xóa', onSelect: vi.fn() }]} />,
    );
    const trigger = screen.getByRole('button', { name: 'Thao tác với LIC-01' });
    expect(trigger.textContent).toBe('');
    expect(trigger.querySelector('svg')).not.toBeNull();
  });

  it('nút ✕ của hộp thoại là SVG, tên giữ "Đóng hộp thoại"', () => {
    renderWithI18n(
      <ConfirmProvider>
        <Dialog open onOpenChange={vi.fn()} title="Sửa thiết bị">
          <p>nội dung</p>
        </Dialog>
      </ConfirmProvider>,
    );
    const close = screen.getByRole('button', { name: 'Đóng hộp thoại' });
    expect(close.textContent).toBe('');
    expect(close.querySelector('svg')).not.toBeNull();
  });

  it('vạch ngăn breadcrumb là chevron SVG', () => {
    const { container } = renderWithI18n(
      <MemoryRouter>
        <DetailHeader
          crumbs={[{ label: 'Thiết bị', to: '/devices' }, { label: 'Router' }, { label: 'SW-01' }]}
          code="SW-01"
        />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'breadcrumb' });
    expect(nav.textContent).not.toContain('›');
    expect(container.querySelectorAll('svg.chevron.crumb-sep')).toHaveLength(2);
  });

  /* Nút chép không dùng ký tự ⧉ / ✓: mỗi phông vẽ một kiểu, có phông không có glyph đó (Q-20). */
  it('nút chép vẽ SVG (CopyIcon), bấm xong đổi sang CheckIcon — không ký tự nào', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(() => Promise.resolve()) } });
    renderWithI18n(<CopyButton value="10.0.0.1" label="Chép IP" />);
    const button = screen.getByRole('button', { name: 'Chép IP' });
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg.glyph-copy')).not.toBeNull();
    await userEvent.click(button);
    expect(await screen.findByTitle('Đã sao chép')).toBe(button);
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg.glyph-check')).not.toBeNull();
    vi.unstubAllGlobals();
  });

  /*
   * Hình chép phải cân giữa khung 24×24: lệch nửa đơn vị đã thấy rõ trong ô vuông 28px. Đường
   * viền tờ sau viết bằng lệnh TUYỆT ĐỐI (M/H/V/A) để bài này đọc được toạ độ điểm cuối.
   */
  it('CopyIcon: hai tờ giấy cân giữa khung 24×24', () => {
    const { container } = renderWithI18n(<CopyIcon />);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const r of container.querySelectorAll('rect')) {
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((a) => Number(r.getAttribute(a)));
      xs.push(x, x + w);
      ys.push(y, y + h);
    }
    let cx = 0;
    let cy = 0;
    for (const p of container.querySelectorAll('path')) {
      const d = p.getAttribute('d')!;
      expect(d, 'chỉ dùng lệnh tuyệt đối').not.toMatch(/[a-z]/);
      for (const [, cmd, args] of d.matchAll(/([MHVA])([^MHVA]*)/g)) {
        const n = args.trim().split(/[\s,]+/).map(Number);
        if (cmd === 'H') cx = n[0];
        else if (cmd === 'V') cy = n[0];
        else [cx, cy] = n.slice(-2);
        xs.push(cx);
        ys.push(cy);
      }
    }
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBe(12);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBe(12);
  });

  it('CopyIcon và CheckIcon là SVG aria-hidden', () => {
    const { container } = renderWithI18n(
      <>
        <CopyIcon />
        <CheckIcon />
      </>,
    );
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);
  });

  it.each([
    ['vault.stepBack', vi_.vault.stepBack],
    ['access.backToList', vi_.access.backToList],
    ['expiry.openRecordShort', vi_.expiry.openRecordShort],
    ['palette.seeAll', vi_.palette.seeAll],
    ['palette.ipSub', vi_.palette.ipSub],
  ])('chuỗi %s không mang mũi tên ký tự', (_key, text) => {
    expect(text).not.toMatch(/[‹›←→]/);
  });
});
