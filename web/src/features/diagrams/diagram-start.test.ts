import { describe, expect, it } from 'vitest';
import { childNodeType, effectiveStart, startChoices, type DiagramStart } from './diagram-start';

describe('startChoices — "Bắt đầu từ" của hộp tạo bản vẽ (Q-23 06/10 chiều)', () => {
  const rows: {
    name: string;
    input: Parameters<typeof startChoices>[0];
    choices: [DiagramStart, string | null][];
    fallback: DiagramStart;
  }[] = [
    {
      name: 'gốc cây, cấp thường: chỉ trang trắng',
      input: { hasParent: false, parentHasContent: false, cabinetLevel: false, cabinetPicked: false },
      choices: [['blank', null]],
      fallback: 'blank',
    },
    {
      name: 'gốc cây, cấp tủ đã chọn tủ: mặc định dựng từ kho',
      input: { hasParent: false, parentHasContent: false, cabinetLevel: true, cabinetPicked: true },
      choices: [
        ['stock', null],
        ['blank', null],
      ],
      fallback: 'stock',
    },
    {
      name: 'cấp tủ chưa chọn tủ: dựng từ kho tắt, mặc định trang trắng',
      input: { hasParent: false, parentHasContent: false, cabinetLevel: true, cabinetPicked: false },
      choices: [
        ['stock', 'pickCabinet'],
        ['blank', null],
      ],
      fallback: 'blank',
    },
    {
      name: 'bản vẽ con cấp thường, cha có nội dung: mặc định TRANG TRẮNG, không còn tự nhân bản',
      input: { hasParent: true, parentHasContent: true, cabinetLevel: false, cabinetPicked: false },
      choices: [
        ['blank', null],
        ['copy', null],
      ],
      fallback: 'blank',
    },
    {
      name: 'bản vẽ con, cha chưa có nội dung: chép tắt',
      input: { hasParent: true, parentHasContent: false, cabinetLevel: false, cabinetPicked: false },
      choices: [
        ['blank', null],
        ['copy', 'parentEmpty'],
      ],
      fallback: 'blank',
    },
    {
      name: 'bản vẽ con cấp tủ đã chọn tủ, cha có nội dung: đủ ba, mặc định dựng từ kho',
      input: { hasParent: true, parentHasContent: true, cabinetLevel: true, cabinetPicked: true },
      choices: [
        ['stock', null],
        ['blank', null],
        ['copy', null],
      ],
      fallback: 'stock',
    },
  ];

  it.each(rows)('$name', ({ input, choices, fallback }) => {
    const result = startChoices(input);
    expect(result.choices.map((c) => [c.value, c.disabledReason])).toEqual(choices);
    expect(result.fallback).toBe(fallback);
  });
});

describe('effectiveStart — lựa chọn của người dùng chỉ giữ khi còn bật', () => {
  const cabinet = startChoices({ hasParent: true, parentHasContent: true, cabinetLevel: true, cabinetPicked: true });
  const noCabinet = startChoices({ hasParent: true, parentHasContent: true, cabinetLevel: true, cabinetPicked: false });
  const floor = startChoices({ hasParent: true, parentHasContent: true, cabinetLevel: false, cabinetPicked: false });

  const rows: { name: string; picked: DiagramStart | null; state: ReturnType<typeof startChoices>; expected: DiagramStart }[] = [
    { name: 'chưa chọn gì → mặc định của cấp', picked: null, state: cabinet, expected: 'stock' },
    { name: 'chọn chép → giữ chép', picked: 'copy', state: cabinet, expected: 'copy' },
    { name: 'chọn dựng từ kho rồi bỏ chọn tủ → về mặc định', picked: 'stock', state: noCabinet, expected: 'blank' },
    { name: 'chọn dựng từ kho rồi đổi sang cấp tầng → về mặc định', picked: 'stock', state: floor, expected: 'blank' },
    { name: 'chọn trang trắng ở cấp tủ → giữ trang trắng', picked: 'blank', state: cabinet, expected: 'blank' },
  ];

  it.each(rows)('$name', ({ picked, state, expected }) => {
    expect(effectiveStart(picked, state)).toBe(expected);
  });
});

describe('childNodeType — bản vẽ con đề xuất loại kế tiếp của bản cha (Q-26 07/10)', () => {
  it.each([
    [null, 'company'],
    ['company', 'site'],
    ['site', 'floor'],
    ['floor', 'room'],
    ['room', 'cabinet'],
    ['cabinet', 'other'],
    ['other', 'other'],
  ] as const)('cha %s → %s', (parent, expected) => {
    expect(childNodeType(parent)).toBe(expected);
  });
});
