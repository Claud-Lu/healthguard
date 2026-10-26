type Locale = 'zh-CN' | 'en-US';
interface TimelineInput { timestamp?: unknown; receivedAt?: unknown; eventTimestamp?: unknown; createdAt?: unknown; sendingStartedAt?: unknown; sentAt?: unknown; reason?: unknown; updatedAt?: unknown; status?: unknown }
interface TimelineRow { label: string; value: string }
type Formatter = (time: number) => string;
const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
const formatted = (value: unknown, locale: Locale, format: Formatter): string => validTime(value) ? format(value) : locale === 'zh-CN' ? '未记录' : 'Not recorded';

export function eventTimelineRows(event: TimelineInput, locale: Locale, format: Formatter): TimelineRow[] {
  const zh = locale === 'zh-CN';
  const rows = [
    { label: zh ? '客户端发生时间' : 'Client event time', value: formatted(event.timestamp, locale, format) },
    { label: zh ? '服务器接收时间' : 'Server received', value: formatted(event.receivedAt, locale, format) }
  ];
  if (validTime(event.timestamp) && validTime(event.receivedAt)) rows.push({ label: zh ? '接收与发生时间差' : 'Receipt minus event time', value: `${event.receivedAt - event.timestamp} ms` });
  return rows;
}

export function eventTimingNote(locale: Locale): string {
  return locale === 'zh-CN'
    ? '时间按浏览器本地时区展示。发生时间由客户端上报；时间差可能来自补报、传输延迟或设备时钟偏差，不能仅凭接收或发信时间判断为刚发生或当前版本故障。历史缺失值不作推算。'
    : 'Times use your browser time zone. Client event time can differ from receipt due to replay, transport delay or device clock skew. Receipt or mail time alone does not establish a new or current-release failure. Missing historical values are not inferred.';
}

export function notificationTimelineRows(job: TimelineInput, locale: Locale, format: Formatter): TimelineRow[] {
  const zh = locale === 'zh-CN';
  const fields = [
    ['eventTimestamp', '客户端发生', 'Client event'],
    ['receivedAt', '服务器接收', 'Server received'],
    ['createdAt', '邮件生成', 'Notification created'],
    ['sendingStartedAt', '发送处理开始', 'Delivery processing started'],
    ['sentAt', '邮件服务器接受', 'SMTP accepted']
  ] as const;
  return fields.map(([key, chinese, english], index) => ({
    label: zh ? chinese : english,
    value: index < 2 && job.reason === 'test' ? zh ? '不适用' : 'N/A' : formatted(job[key], locale, format)
  }));
}
