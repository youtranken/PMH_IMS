import { describe, expect, it } from 'vitest';
import { deviceCellsOnPage } from './photo-bridge';

const DEV = '7b0c1c1e-0000-4000-8000-000000000001';

function file(body: string, second = ''): string {
  return (
    `<mxfile><diagram id="p1" name="A"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram>` +
    `<diagram id="p2" name="B"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${second}</root></mxGraphModel></diagram></mxfile>`
  );
}

function cell(id: string, extra = '', style = 'fillColor=none;shape=mxgraph.cisco.switch;html=0;', geometry = '<mxGeometry width="10" height="10" as="geometry"/>'): string {
  return `<UserObject label="SW-01" ims_device_id="${DEV}" ims_device_code="SW-01"${extra} id="${id}"><mxCell style="${style}" vertex="1" parent="1">${geometry}</mxCell></UserObject>`;
}

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
