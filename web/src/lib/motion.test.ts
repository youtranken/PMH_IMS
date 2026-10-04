import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOTION_EVENT, motionPreference, motionReduced, setMotionPreference } from './motion';

const INIT_SRC = readFileSync(join(__dirname, '../../public/theme-init.js'), 'utf8');

function runInit(): string | undefined {
  delete document.documentElement.dataset.motion;
  new Function(INIT_SRC)();
  return document.documentElement.dataset.motion;
}

function stubSystemReduce(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => ({ matches: reduce && q.includes('reduce'), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

beforeEach(() => stubSystemReduce(false));
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.motion;
});

/*
 * Máy qua phiên từ xa / máy ảo luôn báo "giảm chuyển động" dù người dùng không chọn — họ phải có
 * cách bật lại; ngược lại người nhạy cảm cần tắt được kể cả khi máy cho phép (Q-21).
 */
describe('lựa chọn "Hiệu ứng chuyển động"', () => {
  it('chưa chọn gì (hoặc giá trị lạ) = theo hệ thống', () => {
    expect(motionPreference()).toBe('system');
    localStorage.setItem('ims_motion', 'xyz');
    expect(motionPreference()).toBe('system');
  });

  it.each([
    // [lựa chọn, máy báo giảm chuyển động, có giảm không]
    ['system', false, false],
    ['system', true, true],
    ['on', true, false],
    ['on', false, false],
    ['off', false, true],
    ['off', true, true],
  ] as const)('%s + máy reduce=%s → giảm=%s', (pref, reduce, expected) => {
    stubSystemReduce(reduce);
    setMotionPreference(pref);
    expect(motionPreference()).toBe(pref);
    expect(motionReduced()).toBe(expected);
  });

  it('áp lên <html data-motion>: on/off ghi thẳng, "theo hệ thống" gỡ thuộc tính (CSS tự theo @media)', () => {
    setMotionPreference('on');
    expect(document.documentElement.dataset.motion).toBe('on');
    setMotionPreference('off');
    expect(document.documentElement.dataset.motion).toBe('off');
    setMotionPreference('system');
    expect(document.documentElement.hasAttribute('data-motion')).toBe(false);
  });

  it('phát sự kiện để mọi nơi hiển thị lựa chọn cùng cập nhật', () => {
    const spy = vi.fn();
    window.addEventListener(MOTION_EVENT, spy);
    setMotionPreference('off');
    window.removeEventListener(MOTION_EVENT, spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('kho bị chặn: vẫn áp cho phiên hiện tại, đọc ra "theo hệ thống"', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    setMotionPreference('on');
    expect(document.documentElement.dataset.motion).toBe('on');
    expect(motionPreference()).toBe('system');
    vi.restoreAllMocks();
  });

  it('theme-init.js đặt data-motion trước khi React render — cùng quy ước với lib/motion.ts', () => {
    expect(runInit()).toBeUndefined();
    localStorage.setItem('ims_motion', 'on');
    expect(runInit()).toBe('on');
    localStorage.setItem('ims_motion', 'off');
    expect(runInit()).toBe('off');
    localStorage.setItem('ims_motion', 'system');
    expect(runInit()).toBeUndefined();
  });
});
