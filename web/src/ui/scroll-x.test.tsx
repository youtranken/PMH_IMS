import { describe, expect, it } from 'vitest';
import { fireEvent, renderWithI18n, screen } from '@/test/test-utils';
import { ScrollX, scrollEdges } from '@/ui/scroll-x';

describe('scrollEdges — còn nội dung khuất ở mép nào', () => {
  it.each([
    ['vừa khung, không khuất gì', 0, 800, 800, { start: false, end: false }],
    ['rộng hơn khung, đang ở đầu', 0, 2253, 1000, { start: false, end: true }],
    ['đang ở giữa', 500, 2253, 1000, { start: true, end: true }],
    ['đã cuộn tới cuối', 1253, 2253, 1000, { start: true, end: false }],
    // Trình duyệt phóng to cho ra scrollLeft lẻ (1252.6): lệch dưới 1px vẫn là "đã tới cuối".
    ['lệch nửa pixel ở cuối', 1252.6, 2253, 1000, { start: true, end: false }],
  ])('%s', (_ten, left, scrollWidth, clientWidth, expected) => {
    expect(scrollEdges(left, scrollWidth, clientWidth)).toEqual(expected);
  });
});

function setBox(el: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
}

describe('ScrollX — bảng rộng phải NÓI RA là còn cột bị khuất', () => {
  it('rộng hơn khung → có dòng gợi ý kéo ngang, và vùng cuộn được mô tả bằng nó', () => {
    renderWithI18n(
      <ScrollX ariaLabel="Ma trận quyền">
        <table>
          <tbody>
            <tr>
              <td>x</td>
            </tr>
          </tbody>
        </table>
      </ScrollX>,
    );
    const region = screen.getByRole('region', { name: 'Ma trận quyền' });
    expect(screen.queryByText(/kéo ngang/i)).not.toBeInTheDocument();

    setBox(region, 2253, 1000);
    fireEvent.scroll(region);

    const hint = screen.getByText(/kéo ngang/i);
    expect(hint).toBeVisible();
    expect(region).toHaveAttribute('aria-describedby', hint.id);
    // Vùng cuộn phải nhận được tiêu điểm để người dùng bàn phím cuộn bằng phím mũi tên.
    expect(region).toHaveAttribute('tabindex', '0');
  });
});
