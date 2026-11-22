// The design tokens are the main app's own file, so the two apps cannot drift apart.
import '../../web/src/styles/tokens.css';
import './styles/app.css';
import './styles/glass.css';
import { App } from './app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Vantage Contribute requires an app element.');

new App(root).start();
