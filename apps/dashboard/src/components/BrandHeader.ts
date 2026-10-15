import { defineComponent, h } from 'vue';
import logoUrl from '../assets/logo.svg';

export default defineComponent({
  props: { subtitle: { type: String, default: '' } },
  setup(props) {
    return () => h('div', { class: 'brand' }, [
      h('div', { class: 'brand-title' }, [
        h('img', { class: 'brand-logo', src: logoUrl, width: 32, height: 32, alt: '', 'aria-hidden': 'true' }),
        h('strong', 'HealthGuard')
      ]),
      props.subtitle ? h('span', { class: 'brand-subtitle' }, props.subtitle) : null
    ]);
  }
});
