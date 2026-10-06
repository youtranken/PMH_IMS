import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { LocationText } from '@/ui/location-text';

describe('LocationText', () => {
  it('dấu "·" dính vào mã site (khoảng trắng không ngắt) — chỉ được xuống dòng SAU dấu', () => {
    const { container } = render(<LocationText device={{ siteCode: 'HCM-01', cabinetCode: 'TU-01' }} />);
    expect(container.textContent).toBe('HCM-01 · TU-01');
  });

  it('có U trong tủ thì ghép thêm "· U5–U6" sau mã tủ', () => {
    const { container } = render(<LocationText device={{ siteCode: 'HCM-01', cabinetCode: 'TU-01', rackUStart: 5, rackUSize: 2 }} />);
    expect(container.textContent).toBe('HCM-01\u00a0· TU-01\u00a0· U5–U6');
  });

  it('thiếu tủ thì in nhãn vị trí thường', () => {
    const { container } = render(<LocationText device={{ siteCode: 'HCM-01', cabinetCode: null }} />);
    expect(container.textContent).toContain('HCM-01');
  });
});
