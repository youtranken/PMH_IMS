import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/test-utils';
import { PasswordChecklist } from './password-checklist';

describe('PasswordChecklist — dấu đạt/chưa là hình', () => {
  it('không in ký tự ✓ / ○; dấu là SVG aria-hidden (RuleMark), trạng thái đọc qua chữ ẩn', () => {
    const { container } = renderWithI18n(<PasswordChecklist password="abc" repeat="" />);
    expect(container.textContent).not.toMatch(/[✓○]/);
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(0);
  });
});
