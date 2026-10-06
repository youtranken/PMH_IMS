import { describe, expect, it } from 'vitest';
import { deviceDropXml, dragFrameState, wantsDropFallback } from './stock-drag';

const SPEC = {
  id: 'dev-1',
  code: 'SW-E2E-01 "A&B"',
  cell: { style: 'shape=mxgraph.networks.switch;html=0;', label: 'SW-E2E-01\n10.0.0.2', width: 100, height: 30, attrs: { ims_photo: 'front', ims_device_id: 'gia-mao' } },
};

describe('deviceDropXml — dữ liệu kéo của một dòng "Thiết bị kho" (Q-23 06/10)', () => {
  it('là <mxGraphModel> một ô thiết bị đúng hợp đồng ims_*: draw.io nhận như dán, đặt ở chỗ thả', () => {
    const doc = new DOMParser().parseFromString(deviceDropXml(SPEC), 'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(doc.documentElement.nodeName).toBe('mxGraphModel');
    const objects = doc.getElementsByTagName('UserObject');
    expect(objects).toHaveLength(1);
    const obj = objects[0];
    expect(obj.getAttribute('ims_device_id')).toBe('dev-1');
    expect(obj.getAttribute('ims_device_code')).toBe('SW-E2E-01 "A&B"');
    expect(obj.getAttribute('label')).toBe('SW-E2E-01\n10.0.0.2');
    expect(obj.getAttribute('ims_photo')).toBe('front');
    const cell = obj.getElementsByTagName('mxCell')[0];
    expect(cell.getAttribute('style')).toBe('shape=mxgraph.networks.switch;html=0;');
    expect(cell.getAttribute('vertex')).toBe('1');
    expect(cell.getAttribute('parent')).toBe('1');
    const geometry = cell.getElementsByTagName('mxGeometry')[0];
    expect([geometry.getAttribute('width'), geometry.getAttribute('height')]).toEqual(['100', '30']);
  });
});

describe('dragFrameState / wantsDropFallback — trình duyệt không giao cú thả cho khung khác nguồn', () => {
  const rect = { left: 200, top: 50, right: 1200, bottom: 850 };
  it.each([
    ['rời trang IMS vào trong khung trình vẽ', false, { type: 'dragleave' as const, related: false, x: 310, y: 210 }, true],
    ['rời một phần tử sang phần tử khác của IMS', false, { type: 'dragleave' as const, related: true, x: 310, y: 210 }, false],
    ['rời cửa sổ ra ngoài (không vào khung)', false, { type: 'dragleave' as const, related: false, x: 100, y: 900 }, false],
    ['đang trong khung rồi quay lại trang IMS', true, { type: 'dragenter' as const, related: false, x: 150, y: 100 }, false],
    ['đang trong khung, IMS chỉ báo rời tiếp', true, { type: 'dragleave' as const, related: true, x: 0, y: 0 }, true],
  ])('%s', (_name, inFrame, event, expected) => {
    expect(dragFrameState(inFrame, event, rect)).toBe(expected);
  });

  it.each([
    ['thả trong khung, trình duyệt không cho thả (dropEffect none) → IMS chèn thay', true, 'none', true],
    ['thả trong khung, draw.io đã nhận (copy) → không chèn lần hai', true, 'copy', false],
    ['thả ngoài khung', false, 'none', false],
  ])('%s', (_name, inFrame, dropEffect, expected) => {
    expect(wantsDropFallback(inFrame, dropEffect)).toBe(expected);
  });
});
