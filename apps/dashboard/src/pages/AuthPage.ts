import { h, ref } from 'vue';
import { store, messages, setLocale, loginOrRegister } from '../globalStore';
import type { Locale } from '../i18n';

export default {
  setup() {
    const authMode = ref<'login' | 'register'>('login');
    const email = ref('');
    const password = ref('');

    function languageButton(label: string, value: Locale, current: Locale, onClick: (locale: Locale) => void) {
      return h(
        'button',
        {
          type: 'button',
          class: current === value ? 'language-button active' : 'language-button',
          onClick: () => onClick(value)
        },
        label
      );
    }

    return () => {
      const t = messages.value;

      return h('main', { class: 'auth-page' }, [
        h('section', { class: 'auth-card' }, [
          h('div', { class: 'brand' }, [
            h('strong', 'HealthGuard'),
            h('span', authMode.value === 'login' ? t.login : t.register)
          ]),
          h('div', { class: 'language-row' }, [
            h('span', t.language),
            languageButton('English', 'en-US', store.locale, setLocale),
            languageButton('中文', 'zh-CN', store.locale, setLocale)
          ]),
          h('label', { class: 'field' }, [
            h('span', t.email),
            h('input', {
              value: email.value,
              type: 'email',
              autocomplete: 'email',
              onInput: (event: Event) => {
                email.value = (event.target as HTMLInputElement).value;
              }
            })
          ]),
          h('label', { class: 'field' }, [
            h('span', t.password),
            h('input', {
              value: password.value,
              type: 'password',
              autocomplete: authMode.value === 'login' ? 'current-password' : 'new-password',
              onInput: (event: Event) => {
                password.value = (event.target as HTMLInputElement).value;
              }
            })
          ]),
          h('p', { class: 'help' }, t.passwordHelp),
          h(
            'button',
            {
              type: 'button',
              class: 'wide',
              onClick: () => loginOrRegister(authMode.value, email.value, password.value),
              disabled: store.loading
            },
            authMode.value === 'login' ? t.login : t.register
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'link-button',
              onClick: () => {
                authMode.value = authMode.value === 'login' ? 'register' : 'login';
              }
            },
            authMode.value === 'login' ? t.switchToRegister : t.switchToLogin
          ),
          store.errorMessage ? h('p', { class: 'error' }, store.errorMessage) : null
        ])
      ]);
    };
  }
};
