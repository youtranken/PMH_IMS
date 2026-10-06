import { checkDiagramXml, checkLabelHtml, sanitizeDiagramSvg } from './diagram-gate';

const LIMITS = { xmlMaxKb: 2048, maxCells: 5000 };

function cell(id: string, value: string, style = 'rounded=1;html=1;'): string {
  return `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>`;
}

function page(body: string, attrs = 'id="p1" name="Trang 1"'): string {
  return `<diagram ${attrs}><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram>`;
}

function file(...pages: string[]): string {
  return `<mxfile host="drawio">${pages.join('')}</mxfile>`;
}

describe('checkDiagramXml — cổng XML bản vẽ (AD-17)', () => {
  const ok: [string, string][] = [
    ['bản vẽ trống một trang', file(page(''))],
    ['nhãn chữ thường', file(page(cell('a', 'SW-CORE-01')))],
    ['nhãn HTML định dạng', file(page(cell('a', '&lt;b&gt;SW&lt;/b&gt;&lt;br&gt;&lt;font color=&quot;red&quot;&gt;10.0.0.1&lt;/font&gt;')))],
    ['nhãn có style an toàn', file(page(cell('a', '&lt;span style=&quot;font-size: 12px; color: rgb(0,0,0)&quot;&gt;x&lt;/span&gt;')))],
    ['chữ có dấu nhỏ hơn', file(page(cell('a', 'a &lt; b', 'html=0;')))],
    [
      'ô thiết bị UserObject',
      file(
        page(
          '<UserObject label="SW-01" ims_device_id="7b0c1c1e-0000-4000-8000-000000000001" ims_device_code="SW-01" id="d1"><mxCell style="shape=mxgraph.networks.switch;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="30" as="geometry"/></mxCell></UserObject>',
        ),
      ),
    ],
    ['ảnh nhúng PNG', file(page(cell('a', '', 'shape=image;image=data:image/png,iVBORw0KGgo=;')))],
    ['ảnh nhúng base64 JPEG', file(page(cell('a', '', 'shape=image;image=data:image/jpeg;base64,/9j/4AAQ;')))],
    ['ảnh có sẵn của draw.io (đường tương đối)', file(page(cell('a', '', 'shape=image;image=img/lib/clip_art/networking/Router_128x128.png;')))],
    ['hình stencil mạng', file(page(cell('a', '', 'shape=mxgraph.cisco.routers.router;')))],
    [
      'biểu tượng SVG nhúng có xmlns (hydrate từ Danh mục loại thiết bị)',
      file(page(cell('a', '', `shape=image;image=data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect width="4" height="4"/></svg>')};`))),
    ],
    ['chữ có "on" trong tên thuộc tính tuỳ ý không phải on*', file(page('<UserObject label="x" owner="IT" id="u1"><mxCell vertex="1" parent="1"/></UserObject>'))],
  ];
  it.each(ok)('nhận: %s', (_name, xml) => {
    expect(checkDiagramXml(xml, LIMITS).reason).toBeNull();
  });

  const bad: [string, string, RegExp][] = [
    ['không phải XML', 'không phải xml <', /XML hợp lệ/],
    ['không phải tệp draw.io', '<html><body/></html>', /không phải tệp draw\.io/],
    ['thẻ script', file(page('<script>alert(1)</script>')), /thẻ không được phép.*script/],
    ['thẻ lạ', file(page('<iframe src="x"/>')), /thẻ không được phép.*iframe/],
    ['DOCTYPE', `<!DOCTYPE mxfile [<!ENTITY x SYSTEM "file:///etc/passwd">]>${file(page(cell('a', '&x;')))}`, /DOCTYPE/],
    ['DOCTYPE chữ thường', `<!doctype mxfile>${file(page(''))}`, /DOCTYPE/],
    ['thuộc tính on*', file(page('<mxCell id="a" onclick="alert(1)" vertex="1" parent="1"/>')), /on\*/],
    ['thuộc tính on* viết hoa', file(page('<UserObject label="x" ONLOAD="x" id="u"><mxCell vertex="1" parent="1"/></UserObject>')), /on\*/],
    ['javascript: trong thuộc tính', file(page('<UserObject label="x" ims_note="javascript:alert(1)" id="u"><mxCell vertex="1" parent="1"/></UserObject>')), /javascript/],
    ['java&#9;script: chen tab', file(page('<UserObject label="x" note="java&#9;script:alert(1)" id="u"><mxCell vertex="1" parent="1"/></UserObject>')), /javascript/],
    ['vbscript:', file(page('<UserObject label="x" note="vbscript:x" id="u"><mxCell vertex="1" parent="1"/></UserObject>')), /javascript/],
    ['data:text/html', file(page('<UserObject label="x" note="data:text/html,&lt;b&gt;" id="u"><mxCell vertex="1" parent="1"/></UserObject>')), /javascript/],
    ['thuộc tính link', file(page('<UserObject label="x" link="https://evil.example" id="u"><mxCell vertex="1" parent="1"/></UserObject>')), /link/],
    ['nhãn img onerror', file(page(cell('a', '&lt;img src=x onerror=alert(1)&gt;'))), /Nhãn.*img/],
    ['nhãn svg onload không khoảng trắng', file(page(cell('a', '&lt;svg/onload=alert(1)&gt;'))), /Nhãn.*svg/],
    ['nhãn thẻ cho phép kèm on*', file(page(cell('a', '&lt;b onmouseover=alert(1)&gt;x&lt;/b&gt;'))), /Nhãn/],
    ['nhãn a href', file(page(cell('a', '&lt;a href=&quot;javascript:alert(1)&quot;&gt;x&lt;/a&gt;'))), /Nhãn|javascript/],
    ['nhãn style url()', file(page(cell('a', '&lt;span style=&quot;background:url(https://evil.example/x)&quot;&gt;x&lt;/span&gt;'))), /Nhãn/],
    ['nhãn comment HTML', file(page(cell('a', '&lt;!--x--&gt;'))), /Nhãn/],
    ['nhãn thẻ mở không đóng', file(page(cell('a', '&lt;img src=x onerror=alert(1)'))), /Nhãn/],
    ['nhãn trong thuộc tính tuỳ ý (placeholder)', file(page('<UserObject label="%x%" placeholders="1" x="&lt;img src=x onerror=alert(1)&gt;" id="u"><mxCell vertex="1" parent="1"/></UserObject>')), /Nhãn/],
    ['tooltip HTML độc', file(page('<UserObject label="x" tooltip="&lt;img src=x onerror=alert(1)&gt;" id="u"><mxCell vertex="1" parent="1"/></UserObject>')), /Nhãn/],
    ['ảnh URL ngoài', file(page(cell('a', '', 'shape=image;image=https://evil.example/x.png;'))), /Ảnh/],
    ['ảnh URL không giao thức', file(page(cell('a', '', 'shape=image;image=//evil.example/x.png;'))), /Ảnh/],
    ['ảnh đi lùi thư mục', file(page(cell('a', '', 'shape=image;image=img/../../api/v1/me;'))), /Ảnh/],
    [
      'ảnh SVG nhúng trỏ ra ngoài',
      file(page(cell('a', '', `shape=image;image=data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>')};`))),
      /Ảnh/,
    ],
    ['ảnh data:text/html', file(page(cell('a', '', 'shape=image;image=data:text/html,x;'))), /Ảnh|javascript/],
    ['ảnh nền trang trỏ ra ngoài', file(page('', 'id="p1" name="P"').replace('<mxGraphModel>', '<mxGraphModel backgroundImage="{&quot;src&quot;:&quot;https://evil.example/bg.png&quot;}">')), /Ảnh/],
    ['hai trang', file(page('', 'id="p1"'), page('', 'id="p2"')), /một trang/],
    ['không trang nào', file(), /một trang/],
    ['trang nén', '<mxfile><diagram id="p1">7ZdNb5wwEIZ/DccmKlvTXte620tPHvbMylRJUAxi1f764jqoxG3SNO3FDG8+</diagram></mxfile>', /nén/],
  ];
  it.each(bad)('từ chối: %s', (_name, xml, reason) => {
    const result = checkDiagramXml(xml, LIMITS);
    expect(result.reason).toMatch(reason);
  });

  it('từ chối khi vượt diagram.xml_max_kb, nói rõ trần', () => {
    const xml = file(page(cell('a', 'x'.repeat(3 * 1024))));
    expect(checkDiagramXml(xml, { xmlMaxKb: 2, maxCells: 5000 }).reason).toMatch(/2 KB/);
    expect(checkDiagramXml(xml, { xmlMaxKb: 4, maxCells: 5000 }).reason).toBeNull();
  });

  it('từ chối khi vượt diagram.max_cells, đếm cả ô gốc', () => {
    const xml = file(page(cell('a', 'x') + cell('b', 'y')));
    // 2 ô gốc (0, 1) + 2 ô vẽ = 4.
    expect(checkDiagramXml(xml, { xmlMaxKb: 2048, maxCells: 3 }).reason).toMatch(/4 ô.*3/);
    expect(checkDiagramXml(xml, { xmlMaxKb: 2048, maxCells: 4 }).reason).toBeNull();
  });
});

describe('checkLabelHtml — allowlist thẻ định dạng của nhãn', () => {
  const ok = [
    'SW-01',
    'a < b và c > d',
    '<b>x</b><i>y</i><u>z</u><br/><br>',
    '<div style="text-align:center">x</div>',
    '<font face="Helvetica" color="#ff0000" size="3">x</font>',
    '<ul><li>a</li></ul>',
    '<span style="color: light-dark(rgb(0, 0, 0), rgb(255, 255, 255));">x</span>',
  ];
  it.each(ok)('nhận %s', (html) => {
    expect(checkLabelHtml(html)).toBeNull();
  });

  const bad = [
    '<img src=x>',
    '<IMG SRC=x>',
    '<script>x</script>',
    '<b onclick="x">y</b>',
    '<b  ONCLICK=x>y</b>',
    '<a href="#">x</a>',
    '<span style="background-image:url(x)">y</span>',
    '<span style="width:expression(alert(1))">y</span>',
    '<span style="x:&#117;rl(x)">y</span>',
    '<b style=x onclick=y>z</b>',
    '<!-- x -->',
    '<?xml x?>',
    '</script>',
    '<b/onclick=x>',
    '<math><mi>x</mi></math>',
  ];
  it.each(bad)('từ chối %s', (html) => {
    expect(checkLabelHtml(html)).not.toBeNull();
  });
});

describe('sanitizeDiagramSvg — làm sạch SVG để xem', () => {
  const LIM = { svgMaxKb: 4096 };
  const wrap = (body: string, attrs = '') =>
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"${attrs}>${body}</svg>`;

  it('giữ hình, chữ dự phòng và data-cell-id; bỏ foreignObject, script, style, on*, a ra ngoài, content', () => {
    const svg = wrap(
      '<style>@import url(https://evil.example/x.css)</style>' +
        '<g data-cell-id="a"><rect x="0" y="0" width="5" height="5" fill="#fff" onclick="alert(1)"/>' +
        '<switch><foreignObject width="100%"><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></div></foreignObject><text x="1" y="1">SW-01</text></switch></g>' +
        '<script>alert(1)</script>' +
        '<a xlink:href="https://www.drawio.com/doc"><text>Text is not SVG</text></a>',
      ' content="&lt;mxfile&gt;nén&lt;/mxfile&gt;" onload="alert(1)"',
    );
    const out = sanitizeDiagramSvg(svg, LIM);
    expect(out.reason).toBeNull();
    const clean = out.value!;
    expect(clean).toContain('data-cell-id="a"');
    expect(clean).toContain('<rect');
    expect(clean).toContain('>SW-01</text>');
    for (const gone of ['foreignObject', '<script', 'onclick', 'onload', 'onerror', '<style', 'evil.example', 'drawio.com', 'content=', 'Text is not SVG']) {
      expect(clean).not.toContain(gone);
    }
  });

  it('use chỉ trỏ trong tệp; image chỉ nhận data:image (raster, hoặc SVG — biểu tượng loại thiết bị)', () => {
    const svg = wrap(
      '<defs><path id="p" d="M0 0"/></defs><use href="#p"/><use xlink:href="https://evil.example/s.svg#x"/>' +
        '<image href="data:image/png;base64,iVBOR" width="1" height="1"/><image xlink:href="https://evil.example/a.png"/>' +
        '<image href="data:image/svg+xml;base64,PHN2Zz4="/>',
    );
    const clean = sanitizeDiagramSvg(svg, LIM).value!;
    expect(clean).toContain('<use href="#p"');
    expect(clean).toContain('data:image/png;base64,iVBOR');
    expect(clean).not.toContain('evil.example');
    expect(clean).toContain('data:image/svg+xml;base64,PHN2Zz4=');
  });

  it('bỏ style/thuộc tính trỏ url() ra ngoài, giữ url(#id)', () => {
    const svg = wrap('<rect fill="url(#g)" style="fill:url(https://evil.example/x)" stroke="url(https://evil.example/y)"/>');
    const clean = sanitizeDiagramSvg(svg, LIM).value!;
    expect(clean).toContain('fill="url(#g)"');
    expect(clean).not.toContain('evil.example');
  });

  it('bỏ animate/set (đổi href thành javascript: lúc chạy)', () => {
    const svg = wrap('<a><set attributeName="href" to="javascript:alert(1)"/><animate attributeName="href" values="javascript:x"/><text>x</text></a>');
    const clean = sanitizeDiagramSvg(svg, LIM).value!;
    expect(clean).not.toContain('javascript');
    expect(clean).not.toMatch(/<set|<animate/);
  });

  it('chữ và thuộc tính được thoát lại khi ghi ra', () => {
    const clean = sanitizeDiagramSvg(wrap('<text data-x="a&quot;b">&lt;img onerror=x&gt;</text>'), LIM).value!;
    expect(clean).toContain('data-x="a&quot;b"');
    expect(clean).toContain('&lt;img onerror=x&gt;');
  });

  const bad: [string, string, RegExp][] = [
    ['không phải SVG', '<html/>', /SVG/],
    ['XML hỏng', '<svg', /SVG hợp lệ/],
    ['DOCTYPE', '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>', /DOCTYPE/],
  ];
  it.each(bad)('từ chối: %s', (_name, svg, reason) => {
    expect(sanitizeDiagramSvg(svg, LIM).reason).toMatch(reason);
  });

  it('từ chối khi vượt diagram.svg_max_kb', () => {
    const svg = wrap(`<text>${'x'.repeat(3000)}</text>`);
    expect(sanitizeDiagramSvg(svg, { svgMaxKb: 2 }).reason).toMatch(/2 KB/);
  });
});
