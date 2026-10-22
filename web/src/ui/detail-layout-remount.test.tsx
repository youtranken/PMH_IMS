import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { DetailLayout } from '@/ui/detail-layout';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

function Counter() {
  const [n, setN] = useState(0);
  return (
    <button type="button" onClick={() => setN(n + 1)}>
      Đếm {n}
    </button>
  );
}

/** Đổi bố cục từ BÊN TRONG cây (rerender của test-utils bỏ mất provider, tự nó dựng lại cả cây). */
function Harness({ withSummary = false }: { withSummary?: boolean }) {
  const [rail, setRail] = useState(false);
  const [strip, setStrip] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setRail(true)}>
        Hiện cột phải
      </button>
      <button type="button" onClick={() => setStrip(true)}>
        Thu thành dải
      </button>
      <DetailLayout
        rail={rail || withSummary ? <div>Đợt mua</div> : undefined}
        railSummary={withSummary ? <span>Tóm tắt</span> : undefined}
        railStrip={strip}
      >
        {/* Nhiều con như trang thật (thanh tab + panel): `children` là MẢNG. */}
        <p>Thanh tab</p>
        <Counter />
      </DetailLayout>
    </>
  );
}

/**
 * LF-02: cột phải mọc MUỘN (các đợt mua về sau hồ sơ) làm DetailLayout đổi nhánh. Hai nhánh đặt
 * nội dung chính ở hai vị trí khác nhau, React tháo rồi dựng lại cả cột chính — hộp Gán vừa mở
 * theo "Lưu rồi gán vào máy" biến mất, bộ lọc / trang của tab về mặc định.
 */
describe('DetailLayout — cột phải mọc / mất không dựng lại nội dung chính', () => {
  it('giữ state của nội dung khi cột phải mọc muộn', async () => {
    renderWithI18n(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Đếm 0' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hiện cột phải' }));
    expect(screen.getByRole('button', { name: 'Đếm 1' })).toBeInTheDocument();
  });

  it('giữ state khi thu cột phải thành dải (đổi sang tab bảng)', async () => {
    renderWithI18n(<Harness withSummary />);
    await userEvent.click(screen.getByRole('button', { name: 'Đếm 0' }));
    await userEvent.click(screen.getByRole('button', { name: 'Thu thành dải' }));
    expect(screen.getByRole('button', { name: 'Đếm 1' })).toBeInTheDocument();
  });
});
