import { defineComponent, h, nextTick, ref, type PropType } from 'vue';
import { useRouter } from 'vue-router';
import { renameApp, store, type AppRecord } from '../globalStore';
import { friendlyErrorMessage } from '../api';

export default defineComponent({
  props: {
    app: { type: Object as PropType<AppRecord>, required: true },
    active: Boolean
  },
  setup(props) {
    const router = useRouter();
    const dialog = ref<HTMLDialogElement | null>(null);
    const input = ref<HTMLInputElement | null>(null);
    const name = ref('');
    const saving = ref(false);
    const error = ref('');
    const text = () => store.locale === 'zh-CN'
      ? { rename: '修改名称', title: '修改项目名称', name: '项目名称', hint: '仅修改显示名称，接入配置与历史数据保持不变。', invalid: '请输入 1–100 个字符的项目名称。', cancel: '取消', save: '保存', saving: '保存中…', missing: '项目不存在或无权修改，请刷新列表。' }
      : { rename: 'Rename', title: 'Rename project', name: 'Project name', hint: 'Only the display name changes. Integration settings and history are preserved.', invalid: 'Enter a project name between 1 and 100 characters.', cancel: 'Cancel', save: 'Save', saving: 'Saving…', missing: 'Project not found or access denied. Refresh the list.' };

    async function open(): Promise<void> {
      name.value = props.app.name;
      error.value = '';
      dialog.value?.showModal();
      await nextTick();
      input.value?.focus();
      input.value?.select();
    }
    async function save(event: Event): Promise<void> {
      event.preventDefault();
      if (saving.value) return;
      const value = name.value.trim();
      if (!value || value.length > 100) { error.value = text().invalid; return; }
      saving.value = true;
      error.value = '';
      try {
        await renameApp(props.app.appKey, value);
        dialog.value?.close();
      } catch (cause) {
        const code = (cause as { code?: string }).code;
        error.value = code === 'INVALID_APP_NAME' ? text().invalid : code === 'APP_NOT_FOUND' ? text().missing : friendlyErrorMessage(cause, store.locale);
      } finally { saving.value = false; }
    }
    return () => {
      const t = text();
      const titleId = `rename-title-${props.app.id}`;
      const hintId = `rename-hint-${props.app.id}`;
      return h('div', { class: 'project-row' }, [
        h('button', { type: 'button', class: props.active ? 'app-row active' : 'app-row', onClick: () => router.push(`/projects/${props.app.appKey}`) }, [
          h('span', props.app.name), h('small', props.app.type), h('small', props.app.appKey)
        ]),
        h('button', { type: 'button', class: 'rename-project-button', 'aria-label': `${t.rename}: ${props.app.name}`, onClick: open }, t.rename),
        h('dialog', { ref: dialog, class: 'rename-dialog', 'aria-labelledby': titleId, 'aria-describedby': hintId, onCancel: (event: Event) => { if (saving.value) event.preventDefault(); } }, [
          h('form', { class: 'rename-form', onSubmit: save }, [
            h('h2', { id: titleId }, t.title),
            h('p', { id: hintId }, t.hint),
            h('label', { class: 'field' }, [h('span', t.name), h('input', { ref: input, value: name.value, maxlength: 100, disabled: saving.value, 'aria-invalid': !!error.value, onInput: (event: Event) => { name.value = (event.target as HTMLInputElement).value; error.value = ''; } })]),
            error.value ? h('p', { class: 'error', role: 'alert' }, error.value) : null,
            h('div', { class: 'modal-actions' }, [
              h('button', { type: 'button', class: 'wide secondary', disabled: saving.value, onClick: () => dialog.value?.close() }, t.cancel),
              h('button', { type: 'submit', class: 'wide', disabled: saving.value }, saving.value ? t.saving : t.save)
            ])
          ])
        ])
      ]);
    };
  }
});
