import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { LocationText } from '@/ui/location-text';

describe('LocationText', () => {
  it('dấu "·" dính vào mã site (khoảng trắng không ngắt) — chỉ được xuống dòng SAU dấu', () => {
    const { container } = render(<LocationText device={{ siteCode: 'HCM-01', cabinetCode: 'TU-01' }} />);
    expect(container.textContent).toBe('HCM-01 · TU-01');
  });

  it('thiếu tủ thì in nhãn vị trí thường', () => {
    const { container } = render(<LocationText device={{ siteCode: 'HCM-01', cabinetCode: null }} />);
    expect(container.textContent).toContain('HCM-01');
  });
});
