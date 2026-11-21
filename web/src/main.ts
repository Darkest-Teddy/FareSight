import { AppShell } from './ui/AppShell';
import './styles/tokens.css';
import './styles/app.css';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('FareSight requires a main app element.');

const app = new AppShell(root);
void app.start();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(async () => {
    if (import.meta.env.PROD) (await navigator.serviceWorker.ready).active?.postMessage('warm-demo-cache');
  }).catch((error: unknown) => {
    console.warn('FareSight could not register its offline cache.', error);
  });
}
