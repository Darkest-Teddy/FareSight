// Serves the Contribute app over HTTPS on :5181 so a phone on the same network can use the 360° scan.
// Browsers only open the camera and the motion sensors on a secure page, and http://<LAN-IP> is not one.
// The certificate is self-signed and never leaves this machine, so the phone asks to trust it once.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../.cert/', import.meta.url));
const addresses = Object.values(networkInterfaces()).flat()
  .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
  .map((entry) => entry.address);
const hosts = ['DNS:localhost', 'DNS:contribute.localhost', 'IP:127.0.0.1', ...addresses.map((address) => 'IP:' + address)].join(',');

const reusable = existsSync(dir + 'cert.pem') && existsSync(dir + 'key.pem') && existsSync(dir + 'hosts.txt')
  && readFileSync(dir + 'hosts.txt', 'utf8') === hosts
  && spawnSync('openssl', ['x509', '-in', dir + 'cert.pem', '-noout', '-checkend', '86400'], { stdio: 'ignore' }).status === 0;

let secure = true;
if (!reusable) {
  try {
    mkdirSync(dir, { recursive: true });
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30',
      '-subj', '/CN=Vantage Contribute (development)',
      '-addext', 'subjectAltName=' + hosts, '-addext', 'extendedKeyUsage=serverAuth',
      '-keyout', dir + 'key.pem', '-out', dir + 'cert.pem',
    ], { stdio: 'ignore' });
    writeFileSync(dir + 'hosts.txt', hosts);
  } catch {
    secure = false;
    console.warn('Could not create a certificate (is openssl installed?). The phone will get a simulated camera over http.');
  }
}

// `pnpm dev` passes --with-http and also keeps the plain http://contribute.localhost:5180 server for the desktop.
const children = [];
const serve = (env) => {
  const child = spawn('vite', ['--host', '0.0.0.0'], { stdio: 'inherit', env });
  children.push(child);
  child.on('exit', (code) => {
    for (const other of children) if (other !== child) other.kill();
    process.exit(code ?? 0);
  });
};
if (secure) {
  for (const address of addresses) console.log(`Real camera on the phone: https://${address}:5181 (accept the certificate warning once)`);
  serve({ ...process.env, CONTRIBUTE_CERT_DIR: dir });
}
if (!secure || process.argv.includes('--with-http')) serve(process.env);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { for (const child of children) child.kill(signal); });
