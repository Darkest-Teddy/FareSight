import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { loadEnv as viteLoadEnv, Plugin } from 'vite';

const workspace = fileURLToPath(new URL('../', import.meta.url));

export function seoMetadata(envName: string, loadEnv: typeof viteLoadEnv, pages = ['/index.html']): Plugin {
  const pageUrls = new Map<string, string>();
  let sitemapUrl: URL;
  let publicDir: string;

  return {
    name: 'vantage-seo',
    apply: 'build',
    configResolved(config) {
      const value = (config.env[envName] ?? loadEnv(config.mode, workspace, envName)[envName])?.trim();
      if (!value) return;
      const site = URL.canParse(value) ? new URL(value) : undefined;
      if (!site || !['https:', 'http:'].includes(site.protocol) || site.username || site.password || site.search || site.hash) {
        throw new Error(`${envName} must be an absolute HTTP(S) page URL without credentials, a query, or a fragment.`);
      }

      for (const page of pages) {
        pageUrls.set(page, page === '/index.html' ? site.href : new URL(page, site).href);
      }
      sitemapUrl = new URL('/sitemap.xml', site);
      publicDir = config.publicDir;
    },
    transformIndexHtml(html, { path }) {
      const url = pageUrls.get(path);
      if (!url) return;
      // Contribute builds with a relative base, so its paths start with ./ instead of /.
      const absolute = (value: string) => /^\.?\/(?!\/)/.test(value) ? new URL(value, url).href : value;

      return {
        html: html
          .replace(/(<meta (?:property="og:image"|name="twitter:image") content=")([^"]+)"/g,
            (_, prefix: string, image: string) => `${prefix}${absolute(image)}"`)
          .replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g,
            (_, open: string, json: string, close: string) => {
              const data = JSON.parse(json);
              if (typeof data.image === 'string') data.image = absolute(data.image);
              data.url = url;
              const serialized = JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
              return `${open}\n      ${serialized.replace(/\n/g, '\n      ')}\n    ${close}`;
            }),
        tags: [
          { tag: 'link', attrs: { rel: 'canonical', href: url }, injectTo: 'head' },
          { tag: 'meta', attrs: { property: 'og:url', content: url }, injectTo: 'head' },
        ],
      };
    },
    generateBundle() {
      const appUrl = pageUrls.get('/index.html');
      if (!appUrl) return;
      const urls = Array.from(pageUrls.values(), (url) => `  <url><loc>${url.replace(/&/g, '&amp;')}</loc></url>`);
      const robots = readFileSync(join(publicDir, 'robots.txt'), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `${robots.trimEnd()}\n\nSitemap: ${sitemapUrl.href}\n`,
      });
      const startUrl = new URL(appUrl).pathname;
      if (startUrl !== '/') {
        const manifest = JSON.parse(readFileSync(join(publicDir, 'manifest.webmanifest'), 'utf8'));
        manifest.start_url = startUrl;
        this.emitFile({
          type: 'asset',
          fileName: 'manifest.webmanifest',
          source: `${JSON.stringify(manifest, null, 2)}\n`,
        });
      }
    },
  };
}
