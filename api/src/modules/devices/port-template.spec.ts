import { expandPortTemplate, normalizePortLayout, withTemplatePorts } from './port-template';

describe('expandPortTemplate — cổng mẫu của model (Q-26)', () => {
  const labels = (groups: unknown) => expandPortTemplate(groups, 256).map((p) => `${p.label}/${p.kind}`);

  it.each([
    ['Switch Cisco', [{ pattern: 'Gi1/0/[1-3]', kind: 'rj45' }, { pattern: 'Te1/1/[1-2]', kind: 'sfp+' }], ['Gi1/0/1/rj45', 'Gi1/0/2/rj45', 'Gi1/0/3/rj45', 'Te1/1/1/sfp+', 'Te1/1/2/sfp+']],
    ['FortiGate', [{ pattern: 'wan[1-2]', kind: 'rj45' }, { pattern: 'MGMT', kind: 'rj45' }], ['wan1/rj45', 'wan2/rj45', 'MGMT/rj45']],
    ['một cổng LAN', [{ pattern: ' LAN ', kind: 'rj45' }], ['LAN/rj45']],
    ['mẫu trống → không cổng', [], []],
    ['nhóm trống bị bỏ', [{ pattern: '  ', kind: 'rj45' }, { pattern: 'eth[0-1]', kind: 'other' }], ['eth0/other', 'eth1/other']],
    ['dải ở giữa tên', [{ pattern: 'Port[1-2]A', kind: 'rj45' }], ['Port1A/rj45', 'Port2A/rj45']],
  ])('%s', (_name, groups, expected) => {
    expect(labels(groups)).toEqual(expected);
  });

  it.each([
    ['dải ngược', [{ pattern: 'Port[8-1]', kind: 'rj45' }], /\[8-1\]/],
    ['hai dải một mẫu', [{ pattern: 'Gi[1-2]/0/[1-4]', kind: 'rj45' }], /một dải/],
    ['trùng tên giữa các nhóm', [{ pattern: 'eth[0-1]', kind: 'rj45' }, { pattern: 'eth1', kind: 'rj45' }], /eth1/],
    ['kiểu lạ', [{ pattern: 'eth0', kind: 'usb' }], /Kiểu cổng/],
    ['vượt trần', [{ pattern: 'p[1-300]', kind: 'rj45' }], /256/],
    ['không phải mảng', 'Gi1/0/[1-48]', /danh sách/],
  ])('%s → 400', (_name, groups, message) => {
    let caught: unknown = null;
    try {
      expandPortTemplate(groups, 256);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ response: { code: 'PORT_TEMPLATE_INVALID', message: expect.stringMatching(message) as unknown } });
  });
});

describe('normalizePortLayout — danh sách cổng của một máy', () => {
  it('làm sạch, bỏ dòng trống, giữ thứ tự', () => {
    expect(normalizePortLayout([{ label: ' Gi1 ', kind: 'rj45' }, { label: '', kind: 'rj45' }, { label: 'iDRAC', kind: 'other' }], 256)).toEqual([
      { label: 'Gi1', kind: 'rj45' },
      { label: 'iDRAC', kind: 'other' },
    ]);
  });
  it('trùng nhãn (không phân biệt hoa thường) → 400', () => {
    expect(() => normalizePortLayout([{ label: 'eth0', kind: 'rj45' }, { label: 'ETH0', kind: 'rj45' }], 256)).toThrow();
  });
});

describe('withTemplatePorts — cổng mẫu lan sang máy: chỉ THÊM, không xoá / đổi cổng có sẵn (Q-26 07/10)', () => {
  const rj = (label: string) => ({ label, kind: 'rj45' as const });
  const rows: { name: string; layout: { label: string; kind: 'rj45' | 'sfp' | 'other' }[]; template: { label: string; kind: 'rj45' | 'sfp' }[]; ports: string[]; added: string[] }[] = [
    { name: 'máy trống nhận đủ mẫu', layout: [], template: [rj('p1'), rj('p2')], ports: ['p1/rj45', 'p2/rj45'], added: ['p1', 'p2'] },
    {
      name: 'cổng riêng giữ lại, đứng sau cổng mẫu',
      layout: [{ label: '4', kind: 'other' }],
      template: [rj('Gi1'), rj('Gi2')],
      ports: ['Gi1/rj45', 'Gi2/rj45', '4/other'],
      added: ['Gi1', 'Gi2'],
    },
    {
      name: 'cổng đã có (khác hoa thường) không thêm lần hai, giữ tên và kiểu của máy',
      layout: [{ label: 'GI1', kind: 'other' }],
      template: [rj('Gi1'), { label: 'Te1', kind: 'sfp' }],
      ports: ['GI1/other', 'Te1/sfp'],
      added: ['Te1'],
    },
    { name: 'mẫu ngắn hơn máy: không xoá gì', layout: [rj('p1'), rj('p2'), rj('p3')], template: [rj('p1')], ports: ['p1/rj45', 'p2/rj45', 'p3/rj45'], added: [] },
  ];
  it.each(rows)('$name', ({ layout, template, ports, added }) => {
    const result = withTemplatePorts(layout, template);
    expect(result.ports.map((p) => `${p.label}/${p.kind}`)).toEqual(ports);
    expect(result.added).toEqual(added);
  });
});
