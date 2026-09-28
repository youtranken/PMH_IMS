import { describe, expect, it } from 'vitest';
import { planCopy } from './access-copy';

const rule = (scopeRef: string, tier: 'whitelist' | 'needs_approval', scopeType = 'device_site') => ({
  scopeType,
  scopeRef,
  scopeLabel: `Nhóm ${scopeRef}`,
  tier,
});

describe('planCopy — sao chép quyền két từ đồng nghiệp', () => {
  it.each([
    {
      name: 'người mới chưa có gì → gán đủ mọi nhóm của đồng nghiệp, GIỮ tầng',
      source: [rule('a', 'whitelist'), rule('b', 'needs_approval')],
      target: [],
      grant: ['a:whitelist', 'b:needs_approval'],
      kept: [],
    },
    {
      name: 'nhóm người nhận đã có (dù khác tầng) → bỏ qua, không ghi đè tầng đang có',
      source: [rule('a', 'whitelist'), rule('b', 'needs_approval')],
      target: [rule('a', 'needs_approval')],
      grant: ['b:needs_approval'],
      kept: ['a:whitelist'],
    },
    {
      name: 'cùng scopeRef nhưng khác họ nhóm là HAI nhóm khác nhau',
      source: [rule('x', 'whitelist', 'device_type')],
      target: [rule('x', 'whitelist', 'device_site')],
      grant: ['x:whitelist'],
      kept: [],
    },
    {
      name: 'đồng nghiệp không có quyền nào → không có gì để gán',
      source: [],
      target: [rule('a', 'whitelist')],
      grant: [],
      kept: [],
    },
  ])('$name', ({ source, target, grant, kept }) => {
    const plan = planCopy(source, target);
    expect(plan.grant.map((r) => `${r.scopeRef}:${r.tier}`)).toEqual(grant);
    expect(plan.alreadyHas.map((r) => `${r.scopeRef}:${r.tier}`)).toEqual(kept);
  });
});
