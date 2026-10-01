import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { PhoneLink } from '@/ui/phone-link';
import { PhoneInput } from '@/ui/phone-input';
import { render, screen, userEvent } from '@/test/test-utils';

describe('PhoneLink — số tách nhóm, link gọi số liền', () => {
  it('hiện "0912 345 678", href tel:0912345678', () => {
    render(<PhoneLink value="0912345678" />);
    const link = screen.getByRole('link', { name: '0912 345 678' });
    expect(link.getAttribute('href')).toBe('tel:0912345678');
  });
});

describe('PhoneInput — rời ô thì tách nhóm', () => {
  function Harness() {
    const [value, setValue] = useState('');
    return <PhoneInput id="p" value={value} onChange={setValue} />;
  }
  it('gõ 19006600 rồi rời ô → 1900 6600', async () => {
    render(<Harness />);
    const input = screen.getByRole('textbox');
    await userEvent.type(input, '19006600');
    await userEvent.tab();
    expect(input).toHaveValue('1900 6600');
  });
});
