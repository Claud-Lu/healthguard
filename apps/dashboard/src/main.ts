import { createApp } from 'vue';
import { store, loadProfile, loadApps } from './globalStore';
import router from './router';
import './style.css';

const app = createApp({
  template: '<router-view />'
});

app.use(router);

app.mount('#app');

void loadProfile().then(() => {
  if (store.token) {
    void loadApps();
  }
});
