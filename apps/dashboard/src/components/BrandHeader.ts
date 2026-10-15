import { defineComponent, h } from 'vue';
import { RouterLink } from 'vue-router';
import { store } from '../globalStore';
import logoUrl from '../assets/logo.svg';

export default defineComponent({
  props: { subtitle: { type: String, default: '' } },
  setup(props) {
    return () => h(RouterLink, { to: '/', class: 'brand brand-home-link', 'aria-label': store.locale === 'zh-CN' ? 'HealthGuard · 返回首页' : 'HealthGuard · Back to home' }, { default: () => [
      h('div', { class: 'brand-title' }, [
        h('img', { class: 'brand-logo', src: logoUrl, width: 32, height: 32, alt: '', 'aria-hidden': 'true' }),
        h('strong', 'HealthGuard')
      ]),
      props.subtitle ? h('span', { class: 'brand-subtitle' }, props.subtitle) : null
    ] });
  }
});
