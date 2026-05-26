import { h, ref } from 'vue';
import { useRouter } from 'vue-router';
import { store, messages, setLocale, loginOrRegister } from '../globalStore';
import type { Locale } from '../i18n';

export default {
  setup() {
    const router = useRouter();
    const authMode = ref<'login' | 'register'>('login');
    const email = ref('');
    const password = ref('');
    const showPassword = ref(false);

    async function submitAuth(): Promise<void> {
      const success = await loginOrRegister(authMode.value, email.value, password.value);
      if (success) {
        await router.push('/projects');
      }
    }

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
            h('div', { class: 'password-wrapper' }, [
              h('input', {
                value: password.value,
                type: showPassword.value ? 'text' : 'password',
                autocomplete: authMode.value === 'login' ? 'current-password' : 'new-password',
                onInput: (event: Event) => {
                  password.value = (event.target as HTMLInputElement).value;
                }
              }),
              h('button', {
                type: 'button',
                class: 'toggle-password',
                onClick: () => {
                  showPassword.value = !showPassword.value;
                }
              },
                showPassword.value
                  ? h('svg', {
                    width: '20',
                    height: '20',
                    viewBox: '0 0 24 24',
                    fill: 'none',
                    stroke: 'currentColor',
                    'stroke-width': '2',
                    'stroke-linecap': 'round',
                    'stroke-linejoin': 'round'
                  }, [
                    h('path', { d: 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24' }),
                    h('line', { x1: '1', y1: '1', x2: '23', y2: '23' })
                  ])
                  : h('svg', {
                    width: '20',
                    height: '20',
                    viewBox: '0 0 24 24',
                    fill: 'none',
                    stroke: 'currentColor',
                    'stroke-width': '2',
                    'stroke-linecap': 'round',
                    'stroke-linejoin': 'round'
                  }, [
                    h('path', { d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' }),
                    h('circle', { cx: '12', cy: '12', r: '3' })
                  ])
              )
            ])
          ]),
          h('p', { class: 'help' }, t.passwordHelp),
          h(
            'button',
            {
              type: 'button',
              class: 'wide',
              onClick: submitAuth,
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
