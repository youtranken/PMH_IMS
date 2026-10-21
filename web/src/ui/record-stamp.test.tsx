import { describe, expect, it, vi } from 'vitest';
import { RecordStamp } from '@/ui/record-stamp';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

/** UX-E26: trang chi tiết nói ai tạo / ai sửa lần cuối, bấm được sang Lịch sử. */
describe('RecordStamp', () => {
  it('ngày tạo + sửa lần cuối (họ tên) + bấm mở Lịch sử', async () => {
    const onOpenHistory = vi.fn();
    renderWithI18n(
      <RecordStamp
        createdAt="2026-09-01T03:00:00Z"
        last={{ createdAt: '2026-10-20T03:00:00Z', actor: 'sa@pmh.com.vn', actorName: 'Super Admin' }}
        onOpenHistory={onOpenHistory}
      />,
    );
    expect(screen.getByText(/Tạo 01\/09\/2026/)).toBeInTheDocument();
    const link = screen.getByRole('button', { name: /sửa lần cuối 20\/10\/2026 bởi Super Admin/ });
    await userEvent.click(link);
    expect(onOpenHistory).toHaveBeenCalled();
  });
  it('việc hệ thống tự làm: "bởi Hệ thống"', () => {
    renderWithI18n(<RecordStamp createdAt="2026-09-01T03:00:00Z" last={{ createdAt: '2026-10-20T03:00:00Z', actor: 'system' }} />);
    expect(screen.getByText(/bởi Hệ thống/)).toBeInTheDocument();
  });
  it('chưa có lịch sử: chỉ ngày tạo', () => {
    renderWithI18n(<RecordStamp createdAt="2026-09-01T03:00:00Z" />);
    expect(screen.getByText('Tạo 01/09/2026')).toBeInTheDocument();
    expect(screen.queryByText(/sửa lần cuối/)).toBeNull();
  });
});
