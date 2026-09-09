import { computed, defineComponent, h, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError, apiUrl, formatTime, requestJson } from '../api';
import { logout, store, type AppRecord } from '../globalStore';

interface Sender { host: string; port: number; secure: boolean; username: string; fromEmail: string; fromName: string; hasPassword?: boolean }
interface Rule { enabled: boolean; recipients: string[]; onNewIssue: boolean; onRegression: boolean; threshold: number; cooldownMinutes: number }
interface Job { id: string; status: string; reason: string; subject: string; recipients: string[]; error: string | null; createdAt: number }

const errors: Record<string, [string, string]> = {
  ENCRYPTION_NOT_CONFIGURED: ['发件配置暂不可用，请联系部署管理员。', 'Sender settings are unavailable. Contact your administrator.'],
  INVALID_SENDER: ['请检查 SMTP 服务器、端口和邮箱格式。465 端口需选择 SSL/TLS。', 'Check SMTP host, port and email fields. Port 465 requires SSL/TLS.'],
  SMTP_PASSWORD_REQUIRED: ['首次配置或更换 SMTP 连接时，请填写邮箱授权码。', 'Enter the authorization code when adding or changing the SMTP connection.'],
  INVALID_NOTIFICATION_RULE: ['请检查收件邮箱、触发规则和通知间隔。', 'Check recipients, trigger rules and notification interval.'],
  SMTP_NOT_CONFIGURED: ['请先保存发件邮箱配置。', 'Save sender settings first.'],
  RECIPIENTS_REQUIRED: ['请先保存至少一个收件邮箱。', 'Save at least one recipient first.'],
  TEST_RATE_LIMITED: ['请等待一分钟再发送测试邮件。', 'Wait one minute before sending another test.'],
  SMTP_AUTH_FAILED: ['邮箱认证失败，请检查账号与授权码，并确认已开启 SMTP。', 'SMTP authentication failed. Check the username, authorization code and SMTP access.'],
  SMTP_CONNECTION_FAILED: ['无法连接邮件服务器，请检查地址、端口和网络。', 'Cannot connect to SMTP. Check host, port and network.'],
  SMTP_HOST_BLOCKED: ['该邮件服务器地址不允许连接，请检查 SMTP 域名。', 'This SMTP address is blocked. Check the SMTP hostname.'],
  RECIPIENT_REJECTED: ['部分或全部收件人被拒绝，请核对邮箱。已接收的收件人可能收到邮件。', 'Some or all recipients were rejected. Accepted recipients may receive the email.'],
  SMTP_SEND_FAILED: ['邮件发送失败，请检查邮箱配置后重新测试。', 'Email delivery failed. Check settings and test again.'],
  DELIVERY_UNKNOWN: ['发送时服务中断，结果待核实；为避免重复，未自动重发。', 'Service interrupted during delivery. Check the mailbox; no automatic resend.'],
  NOTIFICATIONS_DISABLED: ['发件配置已移除或项目通知已关闭。', 'Sender removed or project notifications disabled.']
};

export default defineComponent({
  name: 'NotificationSettingsPage',
  setup() {
    const router = useRouter();
    const route = useRoute();
    const zh = computed(() => store.locale === 'zh-CN');
    const t = (cn: string, en: string) => zh.value ? cn : en;
    const sender = reactive<Sender & { password: string }>({ host: '', port: 465, secure: true, username: '', fromEmail: '', fromName: 'HealthGuard', password: '' });
    const rule = reactive<Rule>({ enabled: false, recipients: [], onNewIssue: true, onRegression: true, threshold: 10, cooldownMinutes: 30 });
    const recipientText = ref('');
    const selectedKey = ref('');
    const jobs = ref<Job[]>([]);
    const busy = ref(false);
    const loaded = ref(false);
    const encryptionReady = ref(false);
    const hasSender = ref(false);
    const senderBaseline = ref('');
    const ruleBaseline = ref('');
    const error = ref('');
    const notice = ref('');
    let timer: ReturnType<typeof setInterval> | undefined;
    const senderSnapshot = () => JSON.stringify({ ...sender, password: undefined, hasPassword: undefined });
    const rulePayload = () => ({ ...rule, recipients: [...new Set(recipientText.value.split(/[\s,;，；]+/).map(s => s.trim()).filter(Boolean))] });
    const dirtySender = computed(() => Boolean(sender.password) || senderSnapshot() !== senderBaseline.value);
    const dirtyRule = computed(() => JSON.stringify(rulePayload()) !== ruleBaseline.value);
    const selectedApp = computed(() => store.apps.find(app => app.appKey === selectedKey.value));
    const endpoint = (suffix = '') => `/apps/${encodeURIComponent(selectedKey.value)}/notifications${suffix}`;
    const call = <T>(path: string, method = 'GET', body?: unknown) => requestJson<T>(apiUrl(path), { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, store.token);
    const errorText = (code?: string) => code && errors[code] ? errors[code][zh.value ? 0 : 1] : t('操作失败，请稍后重试。', 'Request failed. Please try again.');
    function handleError(e: unknown) {
      if (e instanceof ApiError && e.status === 401) { logout(); void router.push('/login'); return; }
      error.value = errorText(e instanceof ApiError ? e.code : undefined);
    }
    async function action(fn: () => Promise<void>) {
      busy.value = true; error.value = ''; notice.value = '';
      try { await fn(); } catch (e) { handleError(e); } finally { busy.value = false; }
    }
    async function history() {
      const key = selectedKey.value;
      if (!key) return;
      const result = await call<{ jobs: Job[] }>(endpoint('/history'));
      if (key === selectedKey.value) jobs.value = result.jobs;
    }
    async function selectProject(key: string) {
      if (selectedKey.value === key && ruleBaseline.value) return;
      await action(async () => {
        selectedKey.value = key; ruleBaseline.value = ''; jobs.value = [];
        const result = await call<{ rule: Rule }>(endpoint());
        Object.assign(rule, result.rule); recipientText.value = rule.recipients.join('\n');
        ruleBaseline.value = JSON.stringify(rulePayload());
        await history();
        await router.replace({ path: '/notifications', query: { appKey: key } });
      });
    }
    async function saveSender() {
      await action(async () => {
        const payload = { host: sender.host, port: sender.port, secure: sender.secure, username: sender.username, fromEmail: sender.fromEmail, fromName: sender.fromName, password: sender.password };
        const result = await call<{ sender: Sender }>('/notifications/sender', 'PUT', payload);
        Object.assign(sender, result.sender); sender.password = ''; hasSender.value = true;
        senderBaseline.value = senderSnapshot();
        notice.value = t('发件配置已保存。请保存收件邮箱并发送测试邮件。', 'Sender saved. Save recipients and send a test email.');
      });
    }
    async function saveRule() {
      await action(async () => {
        const result = await call<{ rule: Rule }>(endpoint(), 'PUT', rulePayload());
        Object.assign(rule, result.rule); recipientText.value = rule.recipients.join('\n');
        ruleBaseline.value = JSON.stringify(rulePayload());
        notice.value = t('项目通知设置已保存。', 'Project notification settings saved.');
      });
    }
    async function sendTest() {
      await action(async () => {
        await call(endpoint('/test'), 'POST', {});
        notice.value = t('测试邮件已加入队列，请在下方查看发送结果。', 'Test email queued. Check its delivery status below.');
        await history();
      });
    }
    async function removeSender() {
      if (!window.confirm(t('清除发件配置后，当前账号所有项目将暂停发信。确定清除？', 'Removing the sender pauses email for all your projects. Continue?'))) return;
      await action(async () => {
        await call('/notifications/sender', 'DELETE');
        Object.assign(sender, { host: '', port: 465, secure: true, username: '', fromEmail: '', fromName: 'HealthGuard', password: '', hasPassword: false });
        hasSender.value = false; senderBaseline.value = senderSnapshot();
        if (selectedKey.value) {
          const result = await call<{ rule: Rule }>(endpoint());
          Object.assign(rule, result.rule); recipientText.value = rule.recipients.join('\n');
          ruleBaseline.value = JSON.stringify(rulePayload());
        }
        notice.value = t('发件配置已清除。', 'Sender settings removed.');
      });
    }
    onMounted(async () => {
      await action(async () => {
        const projects = await call<{ apps: AppRecord[] }>('/apps');
        store.apps = projects.apps;
        const result = await call<{ sender: Sender | null; encryptionReady: boolean }>('/notifications/sender');
        encryptionReady.value = result.encryptionReady; hasSender.value = Boolean(result.sender);
        if (result.sender) Object.assign(sender, result.sender);
        senderBaseline.value = senderSnapshot(); loaded.value = true;
      });
      const requested = typeof route.query.appKey === 'string' ? route.query.appKey : '';
      const key = store.apps.find(app => app.appKey === requested)?.appKey ?? store.apps[0]?.appKey;
      if (loaded.value && key) await selectProject(key);
      timer = setInterval(() => {
        if (!busy.value && jobs.value.some(job => ['pending', 'sending'].includes(job.status))) void history().catch(handleError);
      }, 3000);
    });
    onBeforeUnmount(() => clearInterval(timer));
    const input = (id: string, label: string, value: string | number, update: (value: string) => void, options: Record<string, unknown> = {}) => h('label', { class: 'notification-field', for: id }, [
      h('span', label), h('input', { id, value, onInput: (event: Event) => update((event.target as HTMLInputElement).value), ...options })
    ]);
    const check = (id: string, label: string, value: boolean, update: (checked: boolean) => void) => h('label', { class: 'notification-check', for: id }, [
      h('input', { id, type: 'checkbox', checked: value, onChange: (event: Event) => update((event.target as HTMLInputElement).checked) }), h('span', label)
    ]);
    const statusLabel = (status: string) => ({ pending: t('排队中', 'Queued'), sending: t('发送中', 'Sending'), sent: t('邮件服务器已接收', 'Accepted by mail server'), failed: t('发送失败', 'Failed'), canceled: t('已取消', 'Canceled') }[status] ?? status);
    return () => h('main', { class: 'notification-page' }, [
      h('header', { class: 'notification-header' }, [
        h('div', [h('p', { class: 'notification-eyebrow' }, 'HEALTHGUARD · NOTIFICATIONS'), h('h1', t('通知设置', 'Notification settings')), h('p', t('及时了解项目异常。配置发件邮箱，再为各项目选择收件人与提醒规则。', 'Stay informed about project issues. Configure a sender, then choose recipients and rules for each project.'))]),
        h('button', { class: 'outline-button', onClick: () => router.push('/projects') }, t('返回项目列表', 'Back to projects'))
      ]),
      error.value ? h('p', { class: 'notification-banner error', role: 'alert' }, error.value) : null,
      notice.value ? h('p', { class: 'notification-banner success', role: 'status' }, notice.value) : null,
      !loaded.value ? h('p', t('正在加载配置…', 'Loading settings…')) : h('div', { class: 'notification-grid' }, [
        h('section', { class: 'notification-card' }, [
          h('div', { class: 'notification-card-heading' }, [h('h2', t('1. 发件邮箱', '1. Sender mailbox')), h('span', { class: `notification-badge ${hasSender.value ? 'ready' : ''}` }, hasSender.value ? t('已配置', 'Configured') : t('尚未配置', 'Not configured'))]),
          h('p', { class: 'notification-help' }, t('当前账号的项目共用此发件配置。授权码加密保存，保存后不会显示。', 'Your projects share this sender. The authorization code is encrypted and never displayed after saving.')),
          !encryptionReady.value ? h('p', { class: 'notification-banner error' }, errorText('ENCRYPTION_NOT_CONFIGURED')) : null,
          h('form', { onSubmit: (event: Event) => { event.preventDefault(); void saveSender(); } }, [
            h('fieldset', { disabled: busy.value || !encryptionReady.value }, [
              input('sender-email', t('发件邮箱', 'Sender email'), sender.fromEmail, value => { if (!sender.username || sender.username === sender.fromEmail) sender.username = value; sender.fromEmail = value; }, { type: 'email', required: true, placeholder: 'alerts@example.com', autocomplete: 'off' }),
              input('sender-name', t('发件人名称', 'Sender name'), sender.fromName, value => sender.fromName = value, { maxlength: 100 }),
              input('smtp-host', t('SMTP 服务器', 'SMTP server'), sender.host, value => sender.host = value, { required: true, placeholder: 'smtp.example.com', autocomplete: 'off' }),
              h('div', { class: 'notification-inline' }, [input('smtp-port', t('端口', 'Port'), sender.port, value => sender.port = Number(value), { type: 'number', required: true, min: 1, max: 65535 }), h('div', { class: 'notification-field' }, [h('span', t('连接加密', 'Connection security')), h('div', { class: 'notification-security', role: 'group', 'aria-label': t('连接加密', 'Connection security') }, [
                h('button', { type: 'button', 'aria-pressed': sender.secure, class: sender.secure ? 'active' : '', onClick: () => { sender.secure = true; sender.port = 465; } }, 'SSL/TLS'),
                h('button', { type: 'button', 'aria-pressed': !sender.secure, class: !sender.secure ? 'active' : '', onClick: () => { sender.secure = false; sender.port = 587; } }, 'STARTTLS')
              ])])]),
              input('smtp-user', t('SMTP 登录账号', 'SMTP username'), sender.username, value => sender.username = value, { required: true, autocomplete: 'off' }),
              input('smtp-password', t('邮箱授权码 / 应用密码', 'Authorization code / App password'), sender.password, value => sender.password = value, { type: 'password', autocomplete: 'new-password', placeholder: sender.hasPassword ? t('已保存，留空保持原授权码', 'Saved; leave blank to keep it') : t('填写邮箱提供的授权码', 'Enter your mailbox authorization code') }),
              h('p', { class: 'notification-help' }, t('需在邮箱服务商处开启 SMTP。常用端口：465（SSL/TLS）、587（STARTTLS）。', 'Enable SMTP with your email provider. Common ports: 465 (SSL/TLS), 587 (STARTTLS).')),
              h('div', { class: 'notification-actions' }, [h('button', { type: 'submit', class: 'primary' }, t('保存发件配置', 'Save sender')), hasSender.value ? h('button', { type: 'button', class: 'outline-button', onClick: () => { void removeSender(); } }, t('清除配置', 'Remove sender')) : null])
            ])
          ])
        ]),
        h('section', { class: 'notification-card' }, [
          h('h2', t('2. 项目收件人与规则', '2. Project recipients and rules')),
          h('div', { class: 'notification-projects', 'aria-label': t('选择项目', 'Choose a project') }, store.apps.map(project => h('button', { type: 'button', disabled: busy.value, class: selectedKey.value === project.appKey ? 'active' : '', 'aria-pressed': selectedKey.value === project.appKey, onClick: () => { void selectProject(project.appKey); } }, project.name))),
          !store.apps.length ? h('p', t('请先创建一个项目。', 'Create a project first.')) : !ruleBaseline.value ? h('p', t('正在加载项目设置…', 'Loading project settings…')) : h('form', { onSubmit: (event: Event) => { event.preventDefault(); void saveRule(); } }, [
            h('fieldset', { disabled: busy.value }, [
              h('p', { class: 'notification-help' }, selectedApp.value?.name ?? ''),
              check('notify-enabled', t('开启该项目邮件通知', 'Enable email notifications for this project'), rule.enabled, value => rule.enabled = value),
              h('label', { class: 'notification-field', for: 'notify-recipients' }, [h('span', t('接收邮箱', 'Recipients')), h('textarea', { id: 'notify-recipients', rows: 3, value: recipientText.value, placeholder: 'team@example.com\nowner@example.com', onInput: (event: Event) => recipientText.value = (event.target as HTMLTextAreaElement).value })]),
              h('p', { class: 'notification-help' }, t('支持多个邮箱，用换行或逗号分隔，最多 20 个。', 'Separate addresses with new lines or commas, up to 20 recipients.')),
              h('h3', t('触发条件', 'Trigger conditions')),
              check('notify-new', t('首次出现的新异常', 'A new issue appears'), rule.onNewIssue, value => rule.onNewIssue = value),
              check('notify-regression', t('已处理的异常再次出现', 'A previously handled issue reopens'), rule.onRegression, value => rule.onRegression = value),
              h('div', { class: 'notification-inline' }, [
                input('notify-threshold', t('累计次数阈值', 'Total occurrence threshold'), rule.threshold, value => rule.threshold = Number(value), { type: 'number', required: true, min: 0, max: 1000000 }),
                input('notify-cooldown', t('通知间隔（分钟）', 'Interval (minutes)'), rule.cooldownMinutes, value => rule.cooldownMinutes = Number(value), { type: 'number', required: true, min: 1, max: 10080 })
              ]),
              h('p', { class: 'notification-help' }, t('阈值填 0 表示关闭次数提醒。同一异常在间隔内最多提醒一次；达到阈值后，后续新事件可在间隔结束后再次提醒。启用后仅由新上报事件触发。', 'Set threshold to 0 to disable count alerts. Each issue sends at most once per interval; new events above the threshold can alert again after the interval. Only newly reported events trigger alerts.')),
              h('div', { class: 'notification-actions' }, [h('button', { type: 'submit', class: 'primary' }, t('保存项目设置', 'Save project settings')), h('button', { type: 'button', class: 'outline-button', disabled: !hasSender.value || dirtySender.value || dirtyRule.value || !rule.recipients.length, onClick: () => { void sendTest(); } }, t('发送测试邮件', 'Send test email'))]),
              h('p', { class: 'notification-help' }, t('测试前请先保存两侧配置。通知关闭时也可发送测试邮件。', 'Save both forms before testing. Test emails work while alerts are disabled.'))
            ])
          ])
        ])
      ]),
      selectedKey.value ? h('section', { class: 'notification-card notification-history' }, [
        h('div', { class: 'notification-card-heading' }, [h('h2', t('发送记录', 'Delivery history')), h('button', { class: 'outline-button', disabled: busy.value, onClick: () => { void action(history); } }, t('刷新记录', 'Refresh'))]),
        h('p', { class: 'notification-help' }, t('显示所选项目最近 50 条记录。“邮件服务器已接收”不代表已进入收件箱，请同时检查垃圾邮件。', 'Latest 50 messages for the selected project. SMTP acceptance does not guarantee inbox delivery; check spam too.')),
        !jobs.value.length ? h('div', { class: 'notification-empty' }, t('暂无发送记录。配置好邮箱后，可先发一封测试邮件。', 'No messages yet. Configure email and send a test message.')) : h('div', { class: 'notification-table-wrap' }, [h('table', [
          h('thead', [h('tr', [t('时间', 'Time'), t('邮件', 'Message'), t('收件人', 'Recipients'), t('状态', 'Status')].map(label => h('th', label)))]),
          h('tbody', jobs.value.map(job => h('tr', { key: job.id }, [h('td', formatTime(job.createdAt)), h('td', job.subject), h('td', job.recipients.join(', ')), h('td', [h('span', { class: `notification-status ${job.status}` }, statusLabel(job.status)), job.error ? h('p', { class: 'notification-help' }, errorText(job.error)) : null])])))
        ])])
      ]) : null
    ]);
  }
});
