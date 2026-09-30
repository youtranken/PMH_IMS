import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { SubnetCard } from './ipam-screen';
import type { SubnetRow } from './ipam-types';

const base: SubnetRow = {
  id: 's1',
  name: 'LAN văn phòng',
  cidr: '10.0.1.0/24',
  siteId: null,
  siteCode: null,
  vlan: null,
  gateway: null,
  description: null,
  createdBy: 'admin@pmh.com.vn',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  total: 254,
  used: 0,
  free: 254,
  percent: 0,
  addressCount: 3,
  voidedAt: '2026-09-20T03:00:00.000Z',
  voidedBy: 'Nguyễn Văn An',
  voidReason: 'Gộp vào VLAN 20',
};

const noop = () => {};

/*
 * Thẻ dải đã tắt ở danh sách phải trả lời đủ ba câu như trang chi tiết: từ bao giờ, AI tắt,
 * vì sao. Thiếu "ai" thì người thấy dòng gạch ngang phải đi tra nhật ký mới biết hỏi ai.
 */
describe('SubnetCard — dải đã ngừng dùng', () => {
  it('nói ai đã tắt dải, cùng ngày và lý do', () => {
    renderWithI18n(
      <MemoryRouter>
        <SubnetCard
          subnet={base}
          active={false}
          canEdit={false}
          fullPercent={80}
          onEdit={noop}
          onHide={noop}
          onRestore={noop}
          onDelete={noop}
        />
      </MemoryRouter>,
    );
    const note = screen.getByText(/Gộp vào VLAN 20/);
    expect(note).toHaveTextContent('Nguyễn Văn An');
  });

  it('không rõ người tắt (dữ liệu cũ): hiện "—" thay vì bỏ trống', () => {
    renderWithI18n(
      <MemoryRouter>
        <SubnetCard
          subnet={{ ...base, voidedBy: null }}
          active={false}
          canEdit={false}
          fullPercent={80}
          onEdit={noop}
          onHide={noop}
          onRestore={noop}
          onDelete={noop}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Gộp vào VLAN 20/)).toHaveTextContent('bởi —');
  });
});

/* Q-18: "Đã ngừng dùng" là huy hiệu đỏ; "Ngừng dùng" đảo lại được nên chỉ `warn`, "Dùng lại" xanh. */
describe('SubnetCard — màu trạng thái và thao tác', () => {
  function renderCard(subnet: SubnetRow) {
    return renderWithI18n(
      <MemoryRouter>
        <SubnetCard
          subnet={subnet}
          active={false}
          canEdit
          fullPercent={80}
          onEdit={noop}
          onHide={noop}
          onRestore={noop}
          onDelete={noop}
        />
      </MemoryRouter>,
    );
  }

  it('dải đã ngừng dùng: huy hiệu đỏ, "Dùng lại" màu xanh', async () => {
    const user = userEvent.setup();
    renderCard(base);
    expect(screen.getByText('Đã ngừng dùng', { selector: '.badge' })).toHaveClass('danger');
    await user.click(screen.getByRole('button', { name: /Thao tác với/ }));
    expect(screen.getByRole('menuitem', { name: 'Dùng lại' })).toHaveClass('ok');
  });

  it('dải đang dùng: "Ngừng dùng" là việc cảnh báo, không đỏ', async () => {
    const user = userEvent.setup();
    renderCard({ ...base, voidedAt: null, voidedBy: null, voidReason: null });
    await user.click(screen.getByRole('button', { name: /Thao tác với/ }));
    const item = screen.getByRole('menuitem', { name: 'Ngừng dùng' });
    expect(item).toHaveClass('warn');
    expect(item).not.toHaveClass('danger');
  });
});
