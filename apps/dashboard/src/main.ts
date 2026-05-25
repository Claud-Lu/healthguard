import { createApp, h } from 'vue';
import { RouterView } from 'vue-router';
import { store, loadProfile, loadApps } from './globalStore';
import router from './router';
import './style.css';

const app = createApp({
  render: () => h(RouterView)
});

app.use(router);

app.mount('#app');

void loadProfile().then(() => {
  if (store.token) {
    void loadApps();
  }
});
