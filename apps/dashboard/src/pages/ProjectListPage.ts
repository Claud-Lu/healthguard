import { h, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { store, messages, loadApps, logout } from '../globalStore';
import { formatTime } from '../api';

export default {
  setup() {
    const router = useRouter();

    onMounted(() => {
      void loadApps();
    });

    return () => {
      const t = messages.value;

      return h('main', { class: 'layout' }, [
        h('aside', { class: 'sidebar' }, [
          h('div', { class: 'brand' }, [
            h('strong', 'HealthGuard'),
            h('span', store.user?.email ?? '')
          ]),
          h('button', { type: 'button', class: 'wide ghost', onClick: logout }, t.logout)
        ]),
        h('section', { class: 'content' }, [
          h('header', { class: 'topbar' }, [
            h('div', [h('h1', t.projectList), h('p', t.dashboardHomeSubtitle)]),
            store.errorMessage ? h('p', { class: 'error' }, store.errorMessage) : null
          ]),
          h(
            'section',
            { class: 'project-grid' },
            store.apps.length === 0
              ? [h('div', { class: 'panel empty-panel' }, [h('p', { class: 'empty' }, t.emptyProjects)])]
              : store.apps.map((item) =>
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'project-card',
                      onClick: () => router.push(`/projects/${item.appKey}`)
                    },
                    [
                      h('span', item.type),
                      h('strong', item.name),
                      h('code', item.appKey),
                      h('small', `${t.create}: ${formatTime(item.createdAt)}`),
                      h('em', t.selectProject)
                    ]
                  )
                )
          )
        ])
      ]);
    };
  }
};
