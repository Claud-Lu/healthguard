import { computed, defineComponent, h, onBeforeUnmount, ref, watch } from 'vue';
import { deviceContextLines, type DeviceList, type DeviceSummary } from '@health-guard/core';
import { apiUrl, formatTime, requestJson } from '../api';
import { store } from '../globalStore';

export default defineComponent({
  props: { appKey: { type: String, required: true }, platform: String, start: Number, end: Number, refresh: Number },
  setup(props) {
    const zh = computed(() => store.locale === 'zh-CN');
    const result = ref<DeviceList | null>(null);
    const selected = ref<DeviceSummary | null>(null);
    const history = ref<{ events: Array<Record<string, unknown>>; total: number } | null>(null);
    const kind = ref(''); const search = ref(''); const offset = ref(0); const historyOffset = ref(0);
    const loading = ref(false); const historyLoading = ref(false); const error = ref('');
    let generation = 0; let detailGeneration = 0; let searchTimer: ReturnType<typeof setTimeout> | undefined;
    function query(): URLSearchParams {
      const q = new URLSearchParams({ appKey: props.appKey });
      if (props.platform) q.set('platform', props.platform);
      if (props.start !== undefined) q.set('start', String(props.start));
      if (props.end !== undefined) q.set('end', String(props.end));
      return q;
    }
    async function load() {
      const request = ++generation; ++detailGeneration;
      selected.value = null; history.value = null; error.value = ''; loading.value = true;
      const q = query(); q.set('offset', String(offset.value));
      if (kind.value) q.set('kind', kind.value);
      if (search.value) q.set('search', search.value);
      try {
        const value = await requestJson<DeviceList>(apiUrl(`/devices?${q}`), undefined, store.token);
        if (request === generation) result.value = value;
      } catch { if (request === generation) error.value = zh.value ? '设备列表加载失败，请重试。' : 'Unable to load devices. Please retry.'; }
      finally { if (request === generation) loading.value = false; }
    }
    async function open(device: DeviceSummary, page = 0) {
      const request = ++detailGeneration; selected.value = device; history.value = null; historyOffset.value = page;
      historyLoading.value = true; error.value = '';
      const q = query(); q.set('key', device.key); q.set('offset', String(page));
      try {
        const value = await requestJson<{ events: Array<Record<string, unknown>>; total: number }>(apiUrl(`/devices/events?${q}`), undefined, store.token);
        if (request === detailGeneration) history.value = value;
      } catch { if (request === detailGeneration) error.value = zh.value ? '异常历史加载失败，请重试。' : 'Unable to load history. Please retry.'; }
      finally { if (request === detailGeneration) historyLoading.value = false; }
    }
    watch(() => [props.appKey, props.platform, props.start, props.end, props.refresh], () => { offset.value = 0; result.value = null; void load(); }, { immediate: true });
    onBeforeUnmount(() => { ++generation; ++detailGeneration; clearTimeout(searchTimer); });
    const label = (device: DeviceSummary) => device.kind === 'stable' ? device.shortCode!
      : device.kind === 'installation' ? `${zh.value ? '安装标识' : 'Installation'}: ${device.key.slice(13)}` : zh.value ? '未知设备（单条记录）' : 'Unknown device (one record)';
    const button = (text: string, action: () => void, disabled = false) => h('button', { type: 'button', class: 'outline-button', onClick: action, disabled }, text);
    return () => h('section', { class: 'panel device-panel', 'aria-label': zh.value ? '设备异常' : 'Device anomalies', 'data-testid': 'device-panel' }, [
      h('div', { class: 'panel-head' }, [h('h2', zh.value ? '设备异常' : 'Device anomalies'), button(zh.value ? '刷新设备' : 'Refresh devices', () => { void load(); }, loading.value)]),
      h('p', { class: 'device-note' }, zh.value ? '仅统计异常与失败请求，包含已归档问题。安装数不等于设备数；未知记录不按型号合并。筛选沿用平台与时间范围。' : 'Errors and failed requests, including archived issues. Installations are not device counts; unknown records are never merged by model. Platform and time filters apply.'),
      result.value ? h('div', { class: 'device-counts' }, [
        h('span', `${zh.value ? '稳定设备' : 'Stable devices'}: ${result.value.totals.stableDevices}`),
        h('span', `${zh.value ? '仅安装标识' : 'Installation IDs only'}: ${result.value.totals.installations}`),
        h('span', `${zh.value ? '无法识别记录' : 'Unidentified records'}: ${result.value.totals.unidentifiedEvents}`)
      ]) : null,
      h('div', { class: 'device-controls' }, [
        ...[['', zh.value ? '全部' : 'All'], ['stable', zh.value ? '稳定设备' : 'Stable'], ['installation', zh.value ? '安装标识' : 'Installations'], ['unknown', zh.value ? '未知记录' : 'Unknown']].map(([value, text]) =>
          h('button', { type: 'button', 'aria-pressed': kind.value === value, class: 'outline-button', onClick: () => { kind.value = value; offset.value = 0; void load(); } }, text)),
        h('input', { type: 'search', value: search.value, 'aria-label': zh.value ? '搜索设备短码或型号' : 'Search device code or model', placeholder: zh.value ? '设备短码 / 型号' : 'Device code / model', onInput: (e: Event) => {
          search.value = (e.target as HTMLInputElement).value; clearTimeout(searchTimer);
          ++generation; ++detailGeneration; loading.value = true; selected.value = null; history.value = null;
          searchTimer = setTimeout(() => { offset.value = 0; void load(); }, 250);
        } })
      ]),
      error.value ? h('p', { role: 'alert', class: 'error' }, error.value) : null,
      loading.value ? h('p', { role: 'status' }, zh.value ? '正在加载设备…' : 'Loading devices…') : null,
      !loading.value && result.value?.devices.length === 0 ? h('p', zh.value ? '暂无匹配的异常记录' : 'No matching anomalies') : null,
      h('div', { class: 'device-list' }, (loading.value ? [] : result.value?.devices ?? []).map(device => h('button', {
        type: 'button', class: ['device-row', selected.value?.key === device.key ? 'active' : ''],
        'data-kind': device.kind, onClick: () => { void open(device); }
      }, [h('strong', label(device)),
        h('span', `${device.model ?? (zh.value ? '未获取' : 'Unavailable')} · ${device.system ?? (zh.value ? '未获取' : 'Unavailable')}`),
        h('span', `${zh.value ? '异常次数' : 'Anomalies'}: ${device.anomalyCount} · ${device.lastReportedAt == null ? (zh.value ? '最近记录 App（接收时间未知）' : 'Latest recorded App (receipt unknown)') : (zh.value ? '最近上报 App' : 'Latest reported App')}: ${device.latestRelease ?? (zh.value ? '未获取' : 'Unavailable')}`),
        h('span', `${zh.value ? '首次' : 'First'}: ${formatTime(device.firstSeenAt)} · ${zh.value ? '最近发生' : 'Last occurrence'}: ${formatTime(device.lastSeenAt)}`)
      ]))),
      result.value && result.value.total > 50 ? h('div', { class: 'device-controls' }, [
        button(zh.value ? '上一页' : 'Previous', () => { offset.value -= 50; void load(); }, offset.value === 0 || loading.value),
        h('span', `${offset.value + 1}–${Math.min(offset.value + 50, result.value.total)} / ${result.value.total}`),
        button(zh.value ? '下一页' : 'Next', () => { offset.value += 50; void load(); }, offset.value + 50 >= result.value.total || loading.value)
      ]) : null,
      selected.value ? h('div', { class: 'device-history' }, [
        h('div', { class: 'panel-head' }, [h('h3', `${label(selected.value)} · ${zh.value ? '异常历史' : 'Anomaly history'}`), button(zh.value ? '收起设备' : 'Close device', () => { ++detailGeneration; selected.value = null; history.value = null; })]),
        h('p', { class: 'device-identity' }, selected.value.kind === 'stable' ? `${selected.value.deviceId} · ${selected.value.source} / ${selected.value.scope}` : zh.value ? '稳定设备标识未知，不能据此确认物理设备。' : 'Stable device identity is unknown; this does not identify a physical device.'),
        historyLoading.value ? h('p', { role: 'status' }, zh.value ? '正在加载历史…' : 'Loading history…') : null,
        ...history.value?.events.map(event => h('article', { class: 'event-card' }, [
          h('strong', String(event.type === 'http' ? `${event.method} ${event.url}` : event.message)),
          h('p', formatTime(Number(event.timestamp))),
          ...deviceContextLines(event, zh.value ? 'zh' : 'en').map(line => h('p', line)),
          event.errorMessage ? h('p', String(event.errorMessage)) : null
        ])) ?? [],
        history.value && history.value.total > 50 ? h('div', { class: 'device-controls' }, [
          button(zh.value ? '更近记录' : 'Newer', () => { void open(selected.value!, historyOffset.value - 50); }, historyOffset.value === 0),
          h('span', `${historyOffset.value + 1}–${Math.min(historyOffset.value + 50, history.value.total)} / ${history.value.total}`),
          button(zh.value ? '更早记录' : 'Older', () => { void open(selected.value!, historyOffset.value + 50); }, historyOffset.value + 50 >= history.value.total)
        ]) : null
      ]) : null
    ]);
  }
});
