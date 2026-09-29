import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, screen } from '@/test/test-utils';
import { AuditLogLink } from './audit-log-link';

describe('AuditLogLink', () => {
  it('SA/Quản trị: link tới Nhật ký lọc sẵn loại + mã đối tượng', () => {
    renderWithI18n(
      <MemoryRouter>
        <AuditLogLink role="admin" objectType="device" objectId="d-1" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Nhật ký thao tác' })).toHaveAttribute(
      'href',
      '/admin/audit-log?objectType=device&objectId=d-1',
    );
  });

  it('Thành viên không vào được Nhật ký thì không thấy link', () => {
    renderWithI18n(
      <MemoryRouter>
        <AuditLogLink role="member" objectType="device" objectId="d-1" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});
