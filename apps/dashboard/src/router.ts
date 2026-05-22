import { createRouter, createWebHistory } from 'vue-router';
import { store } from './globalStore';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: () => (store.token ? '/projects' : '/login')
    },
    {
      path: '/login',
      name: 'Login',
      component: () => import('./pages/AuthPage')
    },
    {
      path: '/projects',
      name: 'Projects',
      component: () => import('./pages/ProjectListPage')
    },
    {
      path: '/projects/:appKey',
      name: 'ProjectDetail',
      component: () => import('./pages/ProjectDetailPage')
    }
  ]
});

router.beforeEach((to) => {
  if (to.path !== '/login' && !store.token) {
    return '/login';
  }
  if (to.path === '/login' && store.token) {
    return '/projects';
  }
});

export default router;
