import { describe, expect, it } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { DiagramViewer, fitTransform, parseSafeSvg, svgSize } from './diagram-viewer';

const VIEWER = { fullName: 'SA E2E', email: 'sa@e2e.local' };
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400px" height="200px" viewBox="-0.5 -0.5 400 200"><g data-cell-id="s1"><rect width="10" height="10"/><text>Tầng 3</text></g></svg>';

describe('parseSafeSvg — lưới thứ hai sau cổng server (AD-17)', () => {
  it('SVG đã làm sạch: nhận, giữ data-cell-id', () => {
    const result = parseSafeSvg(SVG);
    expect(result.reason).toBeNull();
    expect(result.value?.querySelector('[data-cell-id="s1"]')).not.toBeNull();
  });

  it.each([
    ['script', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ['foreignObject', '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>x</div></foreignObject></svg>'],
    ['thuộc tính on*', '<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)"/></svg>'],
    ['href javascript:', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>'],
    ['ảnh trỏ ra ngoài', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>'],
    ['không phải SVG', '<html><body/></html>'],
    ['XML hỏng', '<svg'],
  ])('từ chối: %s', (_name, markup) => {
    const result = parseSafeSvg(markup);
    expect(result.value).toBeNull();
    expect(result.reason).toBeTruthy();
  });
});

describe('svgSize + fitTransform — vừa khung', () => {
  it('đọc kích thước từ viewBox, lùi về width/height', () => {
    expect(svgSize(parseSafeSvg(SVG).value!)).toEqual({ width: 400, height: 200 });
    expect(svgSize(parseSafeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"/>').value!)).toEqual({ width: 80, height: 40 });
  });

  it.each([
    ['bản vẽ lớn hơn khung: thu nhỏ, căn giữa', { width: 800, height: 400 }, { width: 400, height: 400 }, { scale: 0.5, x: 0, y: 100 }],
    ['bản vẽ nhỏ: không phóng quá 100%', { width: 100, height: 50 }, { width: 400, height: 400 }, { scale: 1, x: 150, y: 175 }],
    ['kích thước 0: giữ nguyên', { width: 0, height: 0 }, { width: 400, height: 400 }, { scale: 1, x: 0, y: 0 }],
  ])('%s', (_name, content, box, expected) => {
    expect(fitTransform(content, box)).toEqual(expected);
  });
});

describe('DiagramViewer', () => {
  it('hiện bản vẽ, watermark người xem, thanh thu phóng', async () => {
    renderWithI18n(<DiagramViewer svg={SVG} viewer={VIEWER} title="Bản vẽ, chỉ xem" />);
    const region = screen.getByRole('region', { name: 'Bản vẽ, chỉ xem' });
    expect(region.querySelector('[data-cell-id="s1"]')).not.toBeNull();
    expect(screen.getAllByText(/SA E2E · sa@e2e\.local · \d{2}:\d{2}/).length).toBeGreaterThan(0);
    const zoom = screen.getByRole('status', { name: 'Mức thu phóng' });
    const before = zoom.textContent;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Phóng to' }));
    expect(zoom.textContent).not.toBe(before);
  });

  it('SVG không an toàn: không chèn gì, báo lỗi', () => {
    renderWithI18n(<DiagramViewer svg='<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' viewer={VIEWER} title="Bản vẽ" />);
    expect(screen.getByRole('alert')).toHaveTextContent('không an toàn');
    expect(document.querySelector('script')).toBeNull();
  });
});

describe('DiagramViewer — ô bấm được và dấu theo ô', () => {
  const TWO =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><g data-cell-id="0"><g data-cell-id="1">' +
    '<g data-cell-id="d1"><rect width="10" height="10"/><text>SW-E2E-01</text></g>' +
    '<g data-cell-id="d2"><rect width="10" height="10"/></g>' +
    '<g data-cell-id="s1"><text>Tầng 3</text></g></g></g></svg>';

  it('ô khai bấm được thành nút có tên (bàn phím + chuột); bấm trúng phần con vẫn ra đúng ô', async () => {
    const clicked: string[] = [];
    renderWithI18n(
      <DiagramViewer
        svg={TWO}
        viewer={VIEWER}
        title="Bản vẽ"
        cells={[
          { id: 'd1', label: 'SW-E2E-01' },
          { id: 'd2', label: 'SW-E2E-GONE', mark: 'danger' },
        ]}
        onCellClick={(id) => clicked.push(id)}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByText('SW-E2E-01'));
    const gone = screen.getByRole('button', { name: 'SW-E2E-GONE' });
    gone.focus();
    await user.keyboard('{Enter}');
    expect(clicked).toEqual(['d1', 'd2']);
    expect(gone.getAttribute('data-ims-mark')).toBe('danger');
    // Hình tự do không thành nút.
    expect(screen.queryByRole('button', { name: 'Tầng 3' })).toBeNull();
  });

  it('kéo để dời khung không tính là bấm ô', async () => {
    const clicked: string[] = [];
    renderWithI18n(<DiagramViewer svg={TWO} viewer={VIEWER} title="Bản vẽ" cells={[{ id: 'd1', label: 'SW-E2E-01' }]} onCellClick={(id) => clicked.push(id)} />);
    const user = userEvent.setup();
    const target = screen.getByText('SW-E2E-01');
    await user.pointer([
      { keys: '[MouseLeft>]', target, coords: { x: 10, y: 10 } },
      { target, coords: { x: 60, y: 40 } },
      { keys: '[/MouseLeft]', target, coords: { x: 60, y: 40 } },
    ]);
    expect(clicked).toEqual([]);
  });
});

describe('DiagramViewer — ghim bình luận (Q-23)', () => {
  const PINNED =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><g data-cell-id="1">' +
    '<g data-cell-id="d1"><rect width="10" height="10"/><text>SW-E2E-01</text></g>' +
    '<g data-cell-id="s1"><text>Tầng 3</text></g></g></svg>';

  it('ghim hiện thành nút đánh số; ô đã bỏ ở phiên bản này hiện ở vị trí cũ kèm "(hình đã bỏ)"', async () => {
    const opened: string[] = [];
    renderWithI18n(
      <DiagramViewer
        svg={PINNED}
        viewer={VIEWER}
        title="Bản vẽ"
        pins={[
          { id: 'p1', cellId: 'd1', anchor: { x: 5, y: 5 }, label: 'Sai cổng uplink', resolved: false },
          { id: 'p2', cellId: 'gone', anchor: { x: 50, y: 60 }, label: 'Bỏ máy này', resolved: true },
        ]}
        onPinClick={(id) => opened.push(id)}
      />,
    );
    const first = screen.getByRole('button', { name: /Ghim 1: Sai cổng uplink/ });
    const removed = screen.getByRole('button', { name: /Ghim 2: Bỏ máy này.*\(hình đã bỏ\)/ });
    expect(removed.getAttribute('data-resolved')).toBe('true');
    expect(removed.style.left).toBe('50px');
    await userEvent.setup().click(first);
    expect(opened).toEqual(['p1']);
  });

  it('chế độ ghim: mọi ô bấm được (kể cả hình tự do), báo kèm toạ độ ô', async () => {
    const picked: [string, { x: number; y: number } | null][] = [];
    renderWithI18n(<DiagramViewer svg={PINNED} viewer={VIEWER} title="Bản vẽ" pickAnyCell onCellClick={(id, at) => picked.push([id, at ?? null])} />);
    await userEvent.setup().click(screen.getByText('Tầng 3'));
    expect(picked.map(([id]) => id)).toEqual(['s1']);
  });
});

describe('DiagramViewer — màu dây và tô sáng (AD-18)', () => {
  const SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><g data-cell-id="0"><g data-cell-id="1">' +
    '<g data-cell-id="d1"><rect width="10" height="10"/><text>SW-E2E-01</text></g>' +
    '<g data-cell-id="d2"><rect width="10" height="10"/><text>SRV-E2E-01</text></g>' +
    '<g data-cell-id="d3"><rect width="10" height="10"/><text>AP-E2E-01</text></g>' +
    '<g data-cell-id="e1"><path d="M0 0L10 10"/></g>' +
    '<g data-cell-id="e2"><path d="M0 0L10 10"/></g>' +
    '<g data-cell-id="g1"><g data-cell-id="s1"><text>Tầng 3</text></g></g></g></g></svg>';

  it('ô dây mang ô màu IMS (data-ims-paint) — CSS tô theo token của theme đang dùng', () => {
    renderWithI18n(
      <DiagramViewer
        svg={SVG}
        viewer={VIEWER}
        title="Bản vẽ"
        cells={[
          { id: 'e1', label: 'Gi1 ↔ eth0', paint: 'cable-2' },
          { id: 'e2', label: 'Chưa khai', paint: 'warn', mark: 'warn' },
        ]}
      />,
    );
    expect(document.querySelector('[data-cell-id="e1"]')?.getAttribute('data-ims-paint')).toBe('cable-2');
    expect(document.querySelector('[data-cell-id="e2"]')?.getAttribute('data-ims-paint')).toBe('warn');
  });

  it('tô sáng: ô được chọn sáng, phần còn lại mờ; lớp/nhóm chứa ô sáng không bị mờ (mờ không nhân đôi)', () => {
    const { rerender } = renderWithI18n(<DiagramViewer svg={SVG} viewer={VIEWER} title="Bản vẽ" highlightCellIds={['d1', 'e1', 'd2']} />);
    const dimmed = () =>
      Array.from(document.querySelectorAll('[data-ims-dim]'))
        .map((el) => el.getAttribute('data-cell-id'))
        .sort();
    expect(dimmed()).toEqual(['d3', 'e2', 'g1']);
    rerender(<DiagramViewer svg={SVG} viewer={VIEWER} title="Bản vẽ" highlightCellIds={null} />);
    expect(dimmed()).toEqual([]);
  });
});
