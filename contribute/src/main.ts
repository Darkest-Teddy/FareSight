import './styles/app.css';
import { App } from './app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Vantage Contribute requires an app element.');

new App(root).start();
