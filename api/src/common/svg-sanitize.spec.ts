import { sanitizeIconSvg, svgTextHasUrl } from './svg-sanitize';

const LIM = { maxKb: 100 };
const NS = 'xmlns="http://www.w3.org/2000/svg"';

describe('sanitizeIconSvg — biểu tượng SVG loại thiết bị do SA tải lên', () => {
  const rejected: [string, string, RegExp][] = [
    ['script', `<svg ${NS}><script>alert(1)</script><rect width="1" height="1"/></svg>`, /script/],
    ['script có tiền tố không gian tên', `<svg ${NS} xmlns:s="http://www.w3.org/2000/svg"><s:script>alert(1)</s:script><rect/></svg>`, /script/],
    ['onload trên gốc', `<svg ${NS} onload="alert(1)"><rect/></svg>`, /sự kiện/],
    ['onclick viết hoa', `<svg ${NS}><rect ONCLICK="x"/></svg>`, /sự kiện/],
    ['javascript: trong href', `<svg ${NS}><use href="javascript:alert(1)"/></svg>`, /javascript/],
    ['java&#9;script: chèn tab', `<svg ${NS}><use href="java&#9;script:alert(1)"/></svg>`, /javascript/],
    ['use trỏ ra ngoài', `<svg ${NS}><use href="https://evil.example/s.svg#x"/></svg>`, /ra ngoài/],
    ['xlink:href ra ngoài', `<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="//evil.example/a.png"/></svg>`, /ra ngoài/],
    ['style url() ra ngoài', `<svg ${NS}><rect style="fill:url(https://evil.example/x)"/></svg>`, /url\(\)/],
    ['DOCTYPE / thực thể', `<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg ${NS}><text>&x;</text></svg>`, /DOCTYPE/],
    ['không phải SVG', '<html><body/></html>', /không phải SVG/],
    ['không phải XML', 'not xml <', /hợp lệ/],
    ['không có hình nào', `<svg ${NS}><g/></svg>`, /không có hình/],
    ['chữ trông như URL', `<svg ${NS}><text>http://evil.example</text></svg>`, /đường dẫn/],
  ];
  it.each(rejected)('từ chối: %s', (_name, svg, reason) => {
    const out = sanitizeIconSvg(svg, LIM);
    expect(out.value).toBeNull();
    expect(out.reason).toMatch(reason);
  });

  it('quá diagram.icon_svg_max_kb → từ chối, nói rõ trần', () => {
    const svg = `<svg ${NS}><path d="${'M0 0 '.repeat(2000)}"/></svg>`;
    expect(sanitizeIconSvg(svg, { maxKb: 2 }).reason).toMatch(/2 KB/);
  });

  it('gỡ foreignObject, style, metadata Inkscape, title/desc; giữ hình, url(#id) và xmlns', () => {
    const svg =
      `<?xml version="1.0"?><svg ${NS} xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 10 10">` +
      '<title>http://x</title><desc>Mô tả</desc><style>rect{fill:red}</style>' +
      '<metadata><rdf>x</rdf></metadata><inkscape:namedview id="n"/>' +
      '<foreignObject><div>html</div></foreignObject>' +
      '<defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs>' +
      '<rect width="10" height="10" fill="url(#g)"/></svg>';
    const out = sanitizeIconSvg(svg, LIM);
    expect(out.reason).toBeNull();
    for (const gone of ['foreignObject', '<style', 'metadata', 'namedview', '<title', '<desc', 'html']) {
      expect(out.value).not.toContain(gone);
    }
    expect(out.value).toContain('fill="url(#g)"');
    expect(out.value).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });

  it('thiếu xmlns thì thêm vào (không có nó trình duyệt không vẽ SVG làm ảnh)', () => {
    const out = sanitizeIconSvg('<svg viewBox="0 0 4 4"><circle r="2"/></svg>', LIM);
    expect(out.reason).toBeNull();
    expect(out.value).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><circle r="2"/></svg>');
  });
});

describe('svgTextHasUrl — SVG nhúng làm ảnh có trỏ ra ngoài không', () => {
  it.each([
    ['chỉ có khai báo không gian tên', `<svg ${NS} xmlns:xlink='http://www.w3.org/1999/xlink'><rect/></svg>`, false],
    ['href ra ngoài', `<svg ${NS}><image href="https://evil.example/a.png"/></svg>`, true],
    ['//host', `<svg ${NS}><image href="//evil.example/a.png"/></svg>`, true],
  ])('%s', (_name, text, expected) => {
    expect(svgTextHasUrl(text)).toBe(expected);
  });
});
