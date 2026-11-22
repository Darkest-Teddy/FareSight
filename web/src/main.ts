import { AppShell } from './ui/AppShell';
import './styles/tokens.css';
import './styles/app.css';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('FareSight requires a main app element.');

const app = new AppShell(root);
void app.start();

// The offline cache is a production feature. In development it only serves stale models: the
// generators rewrite the glb files in place under the same names, so a cached copy wins over the
// rebuilt one and the map silently renders an old version. Vite already serves fresh assets, so
// there is nothing to gain here -- and any cache left over from a previous production visit is
// cleared, otherwise it keeps answering on localhost forever.
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    navigator.serviceWorker.register('/sw.js').then(async () => {
      (await navigator.serviceWorker.ready).active?.postMessage('warm-demo-cache');
    }).catch((error: unknown) => {
      console.warn('FareSight could not register its offline cache.', error);
    });
  } else {
    void navigator.serviceWorker.getRegistrations()
      .then((all) => Promise.all(all.map((one) => one.unregister())))
      .then(() => caches?.keys())
      .then((keys) => Promise.all((keys ?? []).map((key) => caches.delete(key))))
      .catch(() => {});
  }
}
