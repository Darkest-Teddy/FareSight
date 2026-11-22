import { fileURLToPath } from 'node:url';
import type { loadEnv as viteLoadEnv, Plugin } from 'vite';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const ENV_NAME = 'VITE_CONTRIBUTE_URL';

/**
 * Sends each visitor to the right front door before anything is drawn:
 * - a phone goes to Vantage Contribute (VITE_CONTRIBUTE_URL);
 * - everyone else sees the landing page first, and reaches the app from there.
 *
 * The check is a plain script at the top of <head>, because a module script would only run after
 * the page had started to render. Meta Quest counts as a desktop: its browser can report itself as
 * a mobile one, and the headset is what the 3D app is for.
 */
export function entryRedirect(loadEnv: typeof viteLoadEnv, pages: { app: string; intro: string }): Plugin {
  // A JavaScript expression for the Contribute address, or '' when there is none to send phones to.
  let contribute = "''";

  return {
    name: 'vantage-entry-redirect',
    configResolved(config) {
      const value = (config.env[ENV_NAME] ?? loadEnv(config.mode, workspace, ENV_NAME)[ENV_NAME])?.trim();
      if (value) {
        const url = URL.canParse(value) ? new URL(value) : undefined;
        if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
          throw new Error(`${ENV_NAME} must be an absolute HTTP(S) URL without credentials.`);
        }
        contribute = JSON.stringify(url.href).replace(/</g, '\\u003c');
      } else if (config.command === 'serve') {
        // `pnpm dev` serves Contribute over https on :5181 of the same machine (contribute/scripts/dev-https.mjs).
        contribute = "'https://' + location.hostname + ':5181/'";
      } else {
        config.logger.warn(`${ENV_NAME} is not set: phones will get the landing page instead of Vantage Contribute.`);
      }
    },
    transformIndexHtml(_html, { path }) {
      const page = path === pages.app ? 'app' : path === pages.intro ? 'intro' : undefined;
      if (!page) return;
      return [{ tag: 'script', children: script(page, contribute, pages.intro), injectTo: 'head-prepend' }];
    },
  };
}

function script(page: 'app' | 'intro', contribute: string, intro: string) {
  const phone = `
  var ua = navigator.userAgent;
  var data = navigator.userAgentData;
  var phone = !/Quest|OculusBrowser/i.test(ua) && ((data && data.mobile) || /Mobi|iPhone|iPod/i.test(ua));
  var contribute = ${contribute};
  if (phone && contribute) { location.replace(contribute); return; }`;

  // The landing page marks the tab as having seen it, so its own links into the app are let through
  // and a reload inside the app stays there. A new tab or a new visit starts at the landing page again.
  if (page === 'intro') {
    return `(function () {${phone}
  try { sessionStorage.setItem('vantage:intro', '1'); } catch (error) {}
})();`;
  }
  // The referrer covers browsers that block sessionStorage, where the mark above cannot be kept.
  return `(function () {${phone}
  var intro = ${JSON.stringify(intro)};
  var seen = false;
  try { seen = sessionStorage.getItem('vantage:intro') === '1'; } catch (error) {}
  if (!seen) {
    try {
      var from = new URL(document.referrer);
      seen = from.origin === location.origin && from.pathname === intro;
    } catch (error) {}
  }
  if (!seen) location.replace(intro);
})();`;
}
