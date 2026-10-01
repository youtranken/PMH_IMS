import { describe, expect, it, vi } from 'vitest';
import { Select } from '@/ui/select';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

const many = [
  'Switch',
  'Router',
  'Máy chủ',
  'Máy trạm',
  'Laptop',
  'Máy in',
  'UPS',
  'NAS',
  'Máy chấm công',
].map((label, i) => ({ value: `t${i}`, label }));

/*
 * Danh mục vượt 8 mục thì dò bằng mắt chậm: menu phải có ô gõ để lọc, gõ KHÔNG dấu vẫn khớp
 * (cùng luật `foldSearch` = `ims_norm` bên Postgres).
 */
describe('Select — gõ để lọc khi danh sách dài', () => {
  it('trên 8 lựa chọn: có ô lọc, gõ không dấu vẫn khớp, Enter chọn dòng đầu khớp', async () => {
    const onChange = vi.fn();
    renderWithI18n(<Select value="" onChange={onChange} options={many} ariaLabel="Loại" />);
    await userEvent.click(screen.getByRole('button', { name: 'Loại' }));
    const box = screen.getByRole('searchbox', { name: 'Lọc: Loại' });
    await userEvent.type(box, 'may cham');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Máy chấm công']);
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('t8');
  });

  it('không khớp gì: báo rõ, không để menu trống trơn', async () => {
    renderWithI18n(<Select value="" onChange={() => {}} options={many} ariaLabel="Loại" />);
    await userEvent.click(screen.getByRole('button', { name: 'Loại' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Lọc: Loại' }), 'zzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('— Không có lựa chọn —')).toBeInTheDocument();
  });

  it('danh sách ngắn: không có ô lọc', async () => {
    renderWithI18n(
      <Select value="" onChange={() => {}} options={many.slice(0, 4)} ariaLabel="Loại" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Loại' }));
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });
});

describe('Select — nhãn gọn trên nút, nhãn đủ trong menu', () => {
  it('`short` hiện trên nút đã chọn, `label` đầy đủ trong menu', async () => {
    renderWithI18n(
      <Select
        value="s1"
        onChange={() => {}}
        ariaLabel="Site"
        options={[{ value: 's1', label: 'HCM — Trụ sở chính', short: 'HCM' }]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Site' });
    expect(trigger).toHaveTextContent(/^HCM$/);
    await userEvent.click(trigger);
    expect(screen.getByRole('option', { name: 'HCM — Trụ sở chính' })).toBeInTheDocument();
  });

  it('đánh dấu nút đang mang giá trị (để thanh lọc tô ô đang lọc)', () => {
    renderWithI18n(
      <>
        <Select value="" onChange={() => {}} ariaLabel="A" options={[{ value: '', label: 'Tất cả' }]} />
        <Select value="x" onChange={() => {}} ariaLabel="B" options={[{ value: 'x', label: 'X' }]} />
      </>,
    );
    expect(screen.getByRole('button', { name: 'A' })).not.toHaveAttribute('data-filled');
    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('data-filled', 'true');
  });

  it('ô sắp xếp (indicateFilled=false) luôn có giá trị nhưng KHÔNG tô như đang lọc', () => {
    renderWithI18n(
      <Select
        value="newest"
        indicateFilled={false}
        onChange={() => {}}
        ariaLabel="Sắp xếp"
        options={[{ value: 'newest', label: 'Mới trước' }]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Sắp xếp' })).not.toHaveAttribute('data-filled');
  });

  it('chữ dài bị cắt "…" vẫn đọc đủ qua title — trên nút và trong menu', async () => {
    const long = 'HCM-01 — Trụ sở chính tòa nhà A tầng 12 phòng máy chủ';
    renderWithI18n(
      <Select value="s1" onChange={() => {}} ariaLabel="Site" options={[{ value: 's1', label: long, short: 'HCM-01' }]} />,
    );
    const trigger = screen.getByRole('button', { name: 'Site' });
    expect(trigger.querySelector('.fsel-val')).toHaveAttribute('title', long);
    await userEvent.click(trigger);
    expect(screen.getByRole('option', { name: long }).querySelector('[title]')).toHaveAttribute('title', long);
  });
});
