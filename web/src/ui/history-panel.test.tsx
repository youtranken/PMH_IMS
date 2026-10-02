import { describe, expect, it } from 'vitest';
import { renderWithI18n, screen, within } from '@/test/test-utils';
import { HistoryPanel, type HistoryEntry } from '@/ui/history-panel';

/**
 * Lịch sử dạng trục dọc "ga tàu" (Q-20): mỗi lần đổi là một ga trên một đường ray dọc; ga mới
 * nhất (đầu danh sách — API trả mới trước) tô đặc, ga cũ rỗng ruột. Ngày giờ là một cột riêng
 * (desktop bên trái đường ray, màn hẹp xuống dưới dòng — CSS lo), người làm nằm cùng nội dung.
 */

const ENTRIES: HistoryEntry[] = [
  {
    id: 'h2',
    at: '2026-10-01T11:24:00.000Z',
    actor: 'sa@pmh.com.vn',
    actorName: 'Super Admin',
    action: 'Đổi trạng thái',
    detail: 'Đang dùng → Đã ngừng dùng',
    tone: 'status',
  },
  {
    id: 'h1',
    at: '2026-09-30T02:00:00.000Z',
    actor: 'it01@pmh.com.vn',
    action: 'Tạo hồ sơ',
    tone: 'create',
  },
];

describe('HistoryPanel — trục dọc "ga tàu"', () => {
  it('mỗi lần đổi là một ga; ga mới nhất đánh dấu riêng, ga cũ thì không', () => {
    renderWithI18n(<HistoryPanel entries={ENTRIES} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveClass('is-latest');
    expect(items[1]).not.toHaveClass('is-latest');
  });

  it('ngày giờ là phần tử <time> riêng, mang giờ máy đọc được; người làm đứng cùng nội dung', () => {
    renderWithI18n(<HistoryPanel entries={ENTRIES} />);
    const [latest, first] = screen.getAllByRole('listitem');
    const time = latest.querySelector('time');
    expect(time).not.toBeNull();
    expect(time).toHaveAttribute('dateTime', '2026-10-01T11:24:00.000Z');
    // Người làm không còn dính với ngày giờ thành "Tên · giờ" trên cùng một dòng.
    expect(within(latest).getByText('Super Admin')).toHaveAttribute('title', 'sa@pmh.com.vn');
    expect(time?.textContent).not.toContain('Super Admin');
    // Không có họ tên thì hiện email.
    expect(within(first).getByText('it01@pmh.com.vn')).toBeInTheDocument();
    expect(within(latest).getByText('Đang dùng → Đã ngừng dùng')).toBeInTheDocument();
  });

  it('tone tuỳ chọn thành data-tone của ga (màu lấy từ token ở CSS)', () => {
    renderWithI18n(<HistoryPanel entries={ENTRIES} />);
    const [latest, first] = screen.getAllByRole('listitem');
    expect(latest).toHaveAttribute('data-tone', 'status');
    expect(first).toHaveAttribute('data-tone', 'create');
  });

  it('không có dòng nào thì hiện câu trống, không vẽ đường ray', () => {
    renderWithI18n(<HistoryPanel entries={[]} emptyText="Chưa có gì." />);
    expect(screen.getByText('Chưa có gì.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
