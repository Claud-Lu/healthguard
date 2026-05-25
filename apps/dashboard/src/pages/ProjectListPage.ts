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

    function handleLogout(): void {
      logout();
      void router.push('/login');
    }

    return () => {
      const t = messages.value;
      const projectCount = store.apps.length;

      return h('main', { class: 'layout' }, [
        h('aside', { class: 'sidebar' }, [
          h('div', { class: 'brand' }, [
            h('strong', 'HealthGuard'),
            h('span', store.user?.email ?? '')
          ]),
          h('button', { type: 'button', class: 'wide ghost', onClick: handleLogout }, t.logout)
        ]),
        h('section', { class: 'content' }, [
          h('section', { class: 'dashboard-hero' }, [
            h('div', { class: 'hero-copy' }, [
              h('span', { class: 'eyebrow' }, 'HealthGuard'),
              h('h1', t.dashboardIntroTitle),
              h('p', t.dashboardIntroBody),
              h('div', { class: 'hero-tags' }, [
                h('span', t.dashboardIntroPrivacy),
                h('span', t.dashboardIntroPlatforms),
                h('span', t.dashboardIntroDeploy),
                h('span', t.dashboardIntroSdk)
              ])
            ]),
            h('div', { class: 'hero-status' }, [
              h('span', t.projectWorkspace),
              h('strong', String(projectCount)),
              h('small', projectCount === 1 ? t.projectDetail : t.projectList)
            ])
          ]),
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
