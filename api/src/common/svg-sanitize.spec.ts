import { sanitizeIconSvg, sanitizeSvg, svgRenderReason, svgTextHasUrl } from './svg-sanitize';

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

const XL = 'http://www.w3.org/1999/xlink';

/*
 * `href` nằm ở không gian tên nào cũng là `href`: trình duyệt (và resvg) tra thuộc tính theo URI
 * không gian tên + tên cục bộ, không theo chữ tiền tố. So chuỗi "href"/"xlink:href" là để lọt
 * `x:href` với `xmlns:x` trỏ về xlink.
 */
const NAMESPACE_BYPASS: [string, string][] = [
  ['image x:href ra ngoài (xmlns:x = xlink)', `<svg ${NS} xmlns:x="${XL}"><image x:href="https://evil.example/a.png"/><rect/></svg>`],
  ['use x:href sang tệp khác', `<svg ${NS} xmlns:x="${XL}"><use x:href="/file.svg#a"/><rect/></svg>`],
  ['tiền tố khai ở phần tử con', `<svg ${NS}><g xmlns:q="${XL}"><image q:href="//evil.example/a.png"/></g><rect/></svg>`],
  ['XLINK:HREF viết hoa (bộ đọc HTML hạ chữ rồi gán vào xlink)', `<svg ${NS}><image XLINK:HREF="https://evil.example/a.png"/><rect/></svg>`],
  ['xml:base đổi gốc đường dẫn', `<svg ${NS} xml:base="https://evil.example/"><use href="#a"/><rect/></svg>`],
  ['url() viết thoát ký tự CSS', `<svg ${NS}><rect style="fill:u\\72l(https://evil.example/x)"/></svg>`],
  ['image-set() trong style', `<svg ${NS}><rect style="fill:image-set('https://evil.example/x' 1x)"/></svg>`],
];

describe('sanitizeSvg — href theo không gian tên, không theo chữ tiền tố', () => {
  it.each(NAMESPACE_BYPASS)('ảnh xem bản vẽ không còn trỏ ra ngoài: %s', (_name, svg) => {
    const out = sanitizeSvg(svg, { maxKb: 100, what: 'Ảnh SVG bản vẽ', svgImages: true });
    expect(out.reason).toBeNull();
    expect(out.value).not.toMatch(/evil\.example|\/file\.svg|xml:base|\\72/i);
    // Không còn tiền tố lạ: chỉ giữ xlink:href đã soi, xml:space/xml:lang và khai báo xmlns.
    for (const [, prefix] of out.value!.matchAll(/\s([A-Za-z_][\w.-]*):[\w.-]+=/g)) {
      expect(['xlink', 'xml', 'xmlns']).toContain(prefix);
    }
    expect(svgRenderReason(out.value!)).toBeNull();
  });

  it('khai báo lại xmlns:xlink sang URI khác thì bỏ khai báo đó', () => {
    const out = sanitizeSvg(`<svg ${NS} xmlns:xlink="urn:evil"><rect/></svg>`, { maxKb: 100, what: 'x' });
    expect(out.value).not.toContain('urn:evil');
  });

  it('giữ nguyên SVG draw.io bình thường (xlink:href nội bộ, ảnh data:)', () => {
    const svg = `<svg ${NS} xmlns:xlink="${XL}"><defs><path id="p" d="M0 0"/></defs><use xlink:href="#p"/><image xlink:href="data:image/png;base64,iVBOR"/></svg>`;
    expect(sanitizeSvg(svg, { maxKb: 100, what: 'x', svgImages: true }).value).toBe(svg);
  });

  it.each(NAMESPACE_BYPASS.filter(([name]) => !name.startsWith('url()') && !name.startsWith('image-set')))(
    'biểu tượng tải lên bị TỪ CHỐI: %s',
    (_name, svg) => {
      const out = sanitizeIconSvg(svg, LIM);
      expect(out.value).toBeNull();
      expect(out.reason).toMatch(/ra ngoài|xml:base/);
    },
  );
});

describe('svgRenderReason — chặn cuối trước resvg (resvg TỰ ĐỌC tệp cục bộ theo đường tuyệt đối)', () => {
  const nested = (inner: string) => `data:image/svg+xml;base64,${Buffer.from(inner).toString('base64')}`;
  it.each([
    ['href đường tuyệt đối', `<svg ${NS}><image href="/etc/hostname"/></svg>`],
    ['x:href theo xlink', `<svg ${NS} xmlns:x="${XL}"><image x:href="/etc/hostname"/></svg>`],
    ['file://', `<svg ${NS}><image href="file:///etc/hostname"/></svg>`],
    ['đường tương đối', `<svg ${NS}><image href="secret.png"/></svg>`],
    ['xml:base', `<svg ${NS} xml:base="/etc/"><rect/></svg>`],
    ['SVG lồng trong data: trỏ tệp cục bộ', `<svg ${NS}><image href="${nested(`<svg ${NS}><image href="/etc/hostname"/></svg>`)}"/></svg>`],
    ['SVG lồng dạng %-mã hoá', `<svg ${NS}><image href="data:image/svg+xml,${encodeURIComponent(`<svg ${NS}><image href="/x.png"/></svg>`)}"/></svg>`],
    ['tiền tố chưa khai báo', `<svg ${NS}><image x:href="/etc/hostname"/></svg>`],
  ])('từ chối: %s', (_name, svg) => {
    expect(svgRenderReason(svg)).not.toBeNull();
  });

  it.each([
    ['href nội bộ + ảnh png', `<svg ${NS} xmlns:xlink="${XL}"><use xlink:href="#p"/><image href="data:image/png;base64,iVBOR"/></svg>`],
    ['SVG lồng sạch', `<svg ${NS}><image href="${nested(`<svg ${NS}><rect/></svg>`)}"/></svg>`],
  ])('nhận: %s', (_name, svg) => {
    expect(svgRenderReason(svg)).toBeNull();
  });
});
