import { describe, expect, it } from 'vitest';
import { currentChoice, deviceCellsOnPage, photoCellUpdate, photoChoiceReason, styleWithoutKeys, type DeviceLook } from './photo-bridge';

const DEV = '7b0c1c1e-0000-4000-8000-000000000001';
const KEYS = ['shape', 'image', 'imageAspect', 'aspect', 'outlineConnect', 'html', 'verticalLabelPosition', 'verticalAlign'];

function file(body: string, second = ''): string {
  return (
    `<mxfile><diagram id="p1" name="A"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram>` +
    `<diagram id="p2" name="B"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${second}</root></mxGraphModel></diagram></mxfile>`
  );
}

function cell(id: string, extra = '', style = 'fillColor=none;shape=mxgraph.cisco.switch;html=0;'): string {
  return `<UserObject label="SW-01" ims_device_id="${DEV}" ims_device_code="SW-01"${extra} id="${id}"><mxCell style="${style}" vertex="1" parent="1"><mxGeometry width="10" height="10" as="geometry"/></mxCell></UserObject>`;
}

const LOOK: DeviceLook = {
  id: DEV,
  found: true,
  icon: 'shape=mxgraph.cisco.switch;html=0;',
  front: {
    style: 'shape=image;image=data:image/png,AAAA;imageAspect=1;html=0;',
    fileId: 'f-front',
  },
  back: null,
};

describe('deviceCellsOnPage — ô thiết bị của trang đang mở', () => {
  it('chỉ trang được hỏi, đọc lựa chọn ims_photo', () => {
    const xml = file(cell('a') + cell('b', ' ims_photo="front"'), cell('c'));
    expect(deviceCellsOnPage(xml, 'p1').map((c) => [c.id, c.code, c.photo])).toEqual([
      ['a', 'SW-01', null],
      ['b', 'SW-01', 'front'],
    ]);
    expect(deviceCellsOnPage(xml, 'p2').map((c) => c.id)).toEqual(['c']);
    expect(deviceCellsOnPage('rác', 'p1')).toEqual([]);
  });
});

describe('photoChoiceReason — công tắc tắt kèm lý do khi không có ảnh', () => {
  it.each([
    ['icon', LOOK, null],
    ['front', LOOK, null],
    ['back', LOOK, 'noPhoto'],
    ['front', undefined, 'missing'],
    ['front', { ...LOOK, found: false }, 'missing'],
  ] as const)('%s', (choice, look, expected) => {
    expect(photoChoiceReason(look, choice)).toBe(expected);
  });
});

describe('photoCellUpdate — đổi ô giữa Biểu tượng và Ảnh thật', () => {
  it('sang ảnh mặt trước: giữ style tự do của người vẽ, thay phần IMS, ghi ims_photo + id tệp', () => {
    const [c] = deviceCellsOnPage(file(cell('a')), 'p1');
    const update = photoCellUpdate(c, LOOK, 'front', KEYS);
    expect(update.style).toBe('fillColor=none;shape=image;image=data:image/png,AAAA;imageAspect=1;html=0;');
    expect(update.xmlValue).toContain('ims_photo="front"');
    expect(update.xmlValue).toContain('ims_photo_file_id="f-front"');
    expect(update.xmlValue).toContain('ims_device_id="' + DEV + '"');
  });

  it('về biểu tượng: gỡ ims_photo và ảnh nhúng (kể cả ảnh dạng ;base64,)', () => {
    const [c] = deviceCellsOnPage(
      file(cell('a', ' ims_photo="front" ims_photo_file_id="x"', 'fillColor=none;shape=image;image=data:image/png;base64,AAAA;html=0;')),
      'p1',
    );
    expect(currentChoice(c)).toBe('front');
    const update = photoCellUpdate(c, LOOK, 'icon', KEYS);
    expect(update.style).toBe('fillColor=none;shape=mxgraph.cisco.switch;html=0;');
    expect(update.xmlValue).not.toContain('ims_photo');
  });

  it('styleWithoutKeys giữ khoá lạ, bỏ khoá IMS', () => {
    expect(styleWithoutKeys('rounded=1;shape=x;html=1;', KEYS)).toBe('rounded=1;');
    expect(styleWithoutKeys('', KEYS)).toBe('');
  });
});
