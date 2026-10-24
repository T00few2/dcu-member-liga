/**
 * Fail CI on a new high or critical advisory.
 * The names below are already reviewed. npm's suggested fix for them is a
 * downgrade (Firebase 9, or next-pwa 10.2.6) or a transitive bump that
 * `npm audit fix` cannot apply. Dependabot still opens a pull request when
 * a real upstream fix exists.
 */
import { spawnSync } from 'node:child_process';

const ALLOWED = new Set([
    '@babel/plugin-transform-modules-systemjs',
    '@firebase/firestore',
    '@firebase/firestore-compat',
    '@grpc/grpc-js',
    'brace-expansion',
    'browserslist',
    'fast-uri',
    'firebase',
    'flatted',
    'lodash',
    'minimatch',
    'picomatch',
    'rollup',
    'serialize-javascript',
    'source-map-js',
    'undici',
    'vite',
]);

const result = spawnSync('npm', ['audit', '--json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
});
const raw = result.stdout ?? '';
if (!raw) {
    console.error(result.stderr || result.error?.message || 'npm audit produced no output');
    process.exit(1);
}

const report = JSON.parse(raw);
const blocked = [];
for (const [name, info] of Object.entries(report.vulnerabilities ?? {})) {
    if (info.severity !== 'high' && info.severity !== 'critical') continue;
    if (!ALLOWED.has(name)) blocked.push(`${info.severity} ${name}`);
}

if (blocked.length > 0) {
    console.error('New high or critical vulnerabilities:');
    for (const line of blocked.sort()) console.error(`  ${line}`);
    process.exit(1);
}

console.log('No new high or critical vulnerabilities.');
