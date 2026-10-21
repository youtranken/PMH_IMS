import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { CodeInput, IpInput, normalizeIp } from '@/ui/code-input';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

/** FM-04: bàn phím điện thoại tự viết hoa chữ đầu / tự sửa "sw-core" thành "Sw-core". */
describe('CodeInput', () => {
  it('tắt tự viết hoa, tự sửa, kiểm chính tả; font mono', () => {
    renderWithI18n(<CodeInput aria-label="Tên đăng nhập" value="" onChange={() => undefined} />);
    const input = screen.getByRole('textbox', { name: 'Tên đăng nhập' });
    expect(input).toHaveAttribute('autocapitalize', 'none');
    expect(input).toHaveAttribute('autocorrect', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
    expect(input).toHaveClass('inp', 'mono');
  });
  it('caps: bàn phím chữ hoa cho mã / serial', () => {
    renderWithI18n(<CodeInput caps aria-label="Mã" value="" onChange={() => undefined} />);
    expect(screen.getByRole('textbox', { name: 'Mã' })).toHaveAttribute('autocapitalize', 'characters');
  });
});

/** FM-05: bàn phím số iPhone tiếng Việt chỉ có dấu phẩy — "10,20,1,5" phải thành IP. */
describe('normalizeIp', () => {
  it.each([
    ['10,20,1,5', false, '10.20.1.5'],
    ['10.20.1.5', false, '10.20.1.5'],
    ['172.16.10.0 24', true, '172.16.10.0/24'],
    ['172,16,10,0/24', true, '172.16.10.0/24'],
    ['172.16.10.0 24', false, '172.16.10.0 24'],
  ])('%s (cidr=%s) → %s', (raw, cidr, out) => {
    expect(normalizeIp(raw, cidr)).toBe(out);
  });
});

describe('IpInput', () => {
  function Harness() {
    const [v, setV] = useState('');
    return <IpInput aria-label="IP" value={v} onChange={(e) => setV(e.target.value)} />;
  }
  it('bàn phím số, gõ dấu phẩy ra dấu chấm', async () => {
    renderWithI18n(<Harness />);
    const input = screen.getByRole('textbox', { name: 'IP' });
    expect(input).toHaveAttribute('inputmode', 'decimal');
    await userEvent.type(input, '10,20,1,5');
    expect(input).toHaveValue('10.20.1.5');
  });
});
