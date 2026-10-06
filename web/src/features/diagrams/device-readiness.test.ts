import { describe, expect, it } from 'vitest';
import { deviceReadiness, lookPhotoUri, type ReadinessFlag } from './device-readiness';

describe('deviceReadiness — huy hiệu sẵn sàng ở panel "Thiết bị kho" (Q-23 06/10 chiều)', () => {
  const rows: { name: string; input: Parameters<typeof deviceReadiness>[0]; flags: ReadinessFlag[] }[] = [
    { name: 'máy trong tủ có U, ảnh chuẩn: sẵn sàng', input: { cabinetId: 'k1', rackUStart: 5, hasPhoto: true, photoIssue: null }, flags: [] },
    { name: 'máy trong tủ chưa khai U', input: { cabinetId: 'k1', rackUStart: null, hasPhoto: true, photoIssue: null }, flags: ['noU'] },
    { name: 'máy không ở tủ thì không cần U', input: { cabinetId: null, rackUStart: null, hasPhoto: true, photoIssue: null }, flags: [] },
    { name: 'chưa có ảnh riêng lẫn ảnh model', input: { cabinetId: null, rackUStart: null, hasPhoto: false, photoIssue: null }, flags: ['noPhoto'] },
    { name: 'ảnh còn viền', input: { cabinetId: 'k1', rackUStart: 1, hasPhoto: true, photoIssue: 'margins' }, flags: ['recrop'] },
    { name: 'ảnh lệch tỉ lệ n U', input: { cabinetId: 'k1', rackUStart: 1, hasPhoto: true, photoIssue: 'aspect' }, flags: ['recrop'] },
    { name: 'thiếu U và chưa có ảnh: đủ hai, U trước', input: { cabinetId: 'k1', rackUStart: null, hasPhoto: false, photoIssue: null }, flags: ['noU', 'noPhoto'] },
    // Chưa đo xong (ảnh đang tải) thì chưa báo gì về ảnh: báo nhầm "Cắt lại" rồi rút lại là nhấp nháy.
    { name: 'có ảnh mà chưa đo xong: không báo cắt lại', input: { cabinetId: null, rackUStart: null, hasPhoto: true, photoIssue: undefined }, flags: [] },
  ];

  it.each(rows)('$name', ({ input, flags }) => {
    expect(deviceReadiness(input)).toEqual(flags);
  });
});

describe('lookPhotoUri — ảnh thật trong style ô của `device-looks`', () => {
  it.each([
    ['ảnh png', 'shape=image;image=data:image/png;base64,iVBOR+/=;imageAspect=1;aspect=fixed;', 'data:image/png;base64,iVBOR+/='],
    ['ảnh jpeg', 'align=center;shape=image;image=data:image/jpeg;base64,/9j/4AA;imageAspect=1;', 'data:image/jpeg;base64,/9j/4AA'],
    ['biểu tượng SVG không phải ảnh thật', 'shape=image;image=data:image/svg+xml,%3Csvg%3E;imageAspect=0;', null],
    ['hình draw.io', 'shape=mxgraph.cisco.switch;outlineConnect=0;', null],
  ])('%s', (_name, style, expected) => {
    expect(lookPhotoUri(style)).toBe(expected);
  });
});
