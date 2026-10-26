import { describe, expect, it } from 'vitest';
import { eventTimelineRows, notificationTimelineRows, eventTimingNote } from './event-timeline';
const format = (time: number) => new Date(time).toISOString();

describe('monitoring timelines', () => {
  it('shows reported occurrence and server receipt separately, including signed clock differences', () => {
    expect(eventTimelineRows({ timestamp: 1000, receivedAt: 6000 }, 'zh-CN', format)).toEqual([
      { label: '客户端发生时间', value: '1970-01-01T00:00:01.000Z' },
      { label: '服务器接收时间', value: '1970-01-01T00:00:06.000Z' },
      { label: '接收与发生时间差', value: '5000 ms' }
    ]);
    expect(eventTimelineRows({ timestamp: 6000, receivedAt: 1000 }, 'en-US', format)[2].value).toBe('-5000 ms');
    expect(eventTimingNote('zh-CN')).toContain('设备时钟偏差');
    expect(eventTimingNote('en-US')).toContain('clock skew');
  });
  it.each([undefined, null, '', 1234.5, Infinity, NaN, -1, 9e15])('keeps invalid or historical receipt %s unknown', receivedAt => {
    const rows = eventTimelineRows({ timestamp: 0, receivedAt }, 'zh-CN', format);
    expect(rows[0].value).toBe('1970-01-01T00:00:00.000Z');
    expect(rows[1].value).toBe('未记录');
    expect(rows).toHaveLength(2);
  });
  it('keeps all five mail clocks separate and labels legacy/test values without guessing', () => {
    const rows = notificationTimelineRows({ eventTimestamp: 1000, receivedAt: 2000, createdAt: 3000, sendingStartedAt: 4000, sentAt: 5000 }, 'zh-CN', format);
    expect(rows.map(row => row.label)).toEqual(['客户端发生', '服务器接收', '邮件生成', '发送处理开始', '邮件服务器接受']);
    expect(rows.map(row => row.value)).toEqual([1, 2, 3, 4, 5].map(second => format(second * 1000)));
    const legacy = notificationTimelineRows({ createdAt: 3000, updatedAt: 9000, status: 'failed' }, 'en-US', format);
    expect(legacy[0].value).toBe('Not recorded');
    expect(legacy[4].value).toBe('Not recorded');
    const test = notificationTimelineRows({ reason: 'test', createdAt: 3000 }, 'zh-CN', format);
    expect(test[0].value).toBe('不适用');
    expect(test[1].value).toBe('不适用');
  });
});
