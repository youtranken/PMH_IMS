import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen } from '@/test/test-utils';
import { RoleChoice } from './role-choice';

describe('RoleChoice', () => {
  // PW-C27: legend mang `lbl-t` (chỉ có luật trong `.auth-form`) nên to hơn, lệch lề so với nhãn khác.
  it('nhãn nhóm "Vai trò" dùng chung dáng nhãn trường', () => {
    renderWithI18n(<RoleChoice value="member" onChange={vi.fn()} name="role-test" />);
    const group = screen.getByRole('group', { name: 'Vai trò' });
    expect(group.querySelector('legend')).toHaveClass('field-label');
  });
});
