import { describe, expect, it } from 'vitest';
import { renderWithI18n, screen } from '@/test/test-utils';
import { BarButton } from './diagram-bar';

/*
 * Nút trên thanh sơ đồ: rê chuột nói việc này để làm gì; nút TẮT thì rê chuột nói vì sao tắt
 * (`useDisabledReason`) — câu giải thích không được đè mất lý do.
 */
describe('BarButton — title', () => {
  it('nút bật: title là câu giải thích', () => {
    renderWithI18n(<BarButton action={{ key: 'publish', label: 'Phát hành', help: 'Đưa bản này thành bản chính thức', onSelect: () => {} }} />);
    expect(screen.getByRole('button', { name: 'Phát hành' })).toHaveAttribute('title', 'Đưa bản này thành bản chính thức');
  });

  it('nút tắt: title là lý do tắt', () => {
    renderWithI18n(
      <BarButton action={{ key: 'publish', label: 'Phát hành', help: 'Đưa bản này thành bản chính thức', disabledReason: 'Bản nháp còn dây chưa khai', onSelect: () => {} }} />,
    );
    expect(screen.getByRole('button', { name: 'Phát hành' })).toHaveAttribute('title', 'Bản nháp còn dây chưa khai');
  });
});
