#!/usr/bin/env node

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { promisify } = require('util');
const { exec, execSync, spawn, spawnSync } = require('child_process');

try {
  require('dotenv').config();
} catch (_) {}

const execAsync = promisify(exec);
const app = express();
app.disable('x-powered-by');

function envTrue(value) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return false;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function toPort(value, fallback = '') {
  if (value === null || value === undefined || value === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fallback;
  return port;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeSubPath(input) {
  const cleaned = String(input || 'sub').replace(/^\/+|\/+$/g, '');
  return cleaned || 'sub';
}

function buildProjectSubUrl() {
  if (!PROJECT_URL) return '';
  return `${String(PROJECT_URL).replace(/\/+$/, '')}/${SUB_PATH}`;
}

function generateRandomName(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

const UPLOAD_URL = process.env.UPLOAD_URL || '';
const PROJECT_URL = process.env.PROJECT_URL || '';
const AUTO_ACCESS = envTrue(process.env.AUTO_ACCESS);
const YT_WARPOUT = envTrue(process.env.YT_WARPOUT);
const FILE_PATH = process.env.FILE_PATH || '/tmp/nodejs';
const SUB_PATH = sanitizeSubPath(process.env.SUB_PATH || 'sub');
const UUID = process.env.UUID || '0a6568ff-ea3c-4271-9020-450560e10d63';
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';
const NEZHA_PORT = process.env.NEZHA_PORT || '';
const NEZHA_KEY = process.env.NEZHA_KEY || '';
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';
const ARGO_AUTH = process.env.ARGO_AUTH || '';
const ARGO_PORT = toPort(process.env.ARGO_PORT, 8001);
const S5_PORT = process.env.S5_PORT || '';
const TUIC_PORT = process.env.TUIC_PORT || '';
const HY2_PORT = process.env.HY2_PORT || '';
const ANYTLS_PORT = process.env.ANYTLS_PORT || '';
const REALITY_PORT = process.env.REALITY_PORT || '';
const ANYREALITY_PORT = process.env.ANYREALITY_PORT || '';
const CFIP = process.env.CFIP || 'saas.sin.fan';
const CFPORT = process.env.CFPORT || 443;
const PORT = toPort(process.env.SERVER_PORT || process.env.PORT, 3000);
const NAME = process.env.NAME || '';
const CHAT_ID = process.env.CHAT_ID || '';
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const DISABLE_ARGO = envTrue(process.env.DISABLE_ARGO);

fs.mkdirSync(FILE_PATH, { recursive: true });

const BIN = {
  npm: path.join(FILE_PATH, generateRandomName()),
  php: path.join(FILE_PATH, generateRandomName()),
  web: path.join(FILE_PATH, generateRandomName()),
  bot: path.join(FILE_PATH, generateRandomName()),
};

const PATHS = {
  sub: path.join(FILE_PATH, 'sub.txt'),
  list: path.join(FILE_PATH, 'list.txt'),
  bootLog: path.join(FILE_PATH, 'boot.log'),
  config: path.join(FILE_PATH, 'config.json'),
  nezhaConfig: path.join(FILE_PATH, 'config.yaml'),
  key: path.join(FILE_PATH, 'key.txt'),
  privateKey: path.join(FILE_PATH, 'private.key'),
  cert: path.join(FILE_PATH, 'cert.pem'),
  tunnelJson: path.join(FILE_PATH, 'tunnel.json'),
  tunnelYaml: path.join(FILE_PATH, 'tunnel.yml'),
};

const state = {
  ready: false,
  initialized: false,
  initializing: false,
  lastError: '',
  argoDomain: '',
  subBase64: '',
  listText: '',
};

const children = {
  nezha: null,
  web: null,
  bot: null,
};

let privateKey = '';
let publicKey = '';

function isValidPort(port) {
  return toPort(port, null) !== null;
}

function commandExists(command) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { stdio: 'ignore' });
  return result.status === 0;
}

function readIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return '';
  }
}

function writeFileSafe(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

async function ensureExecutable(filePath) {
  if (!fs.existsSync(filePath)) return;
  await fs.promises.chmod(filePath, 0o775).catch(() => {});
}

async function downloadFile(targetPath, url, retries = 2) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      const response = await axios({
        method: 'get',
        url,
        responseType: 'stream',
        timeout: 30000,
        maxRedirects: 5,
      });

      await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(targetPath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      await ensureExecutable(targetPath);
      console.log(`Download ${path.basename(targetPath)} successfully`);
      return;
    } catch (error) {
      lastError = error;
      try {
        fs.unlinkSync(targetPath);
      } catch (_) {}

      if (attempt <= retries) {
        console.log(`Download ${path.basename(targetPath)} failed, retry ${attempt}/${retries}`);
        await sleep(1000 * attempt);
      }
    }
  }

  throw new Error(`Download ${path.basename(targetPath)} failed: ${lastError ? lastError.message : 'unknown error'}`);
}

function getSystemArchitecture() {
  const arch = os.arch();
  return ['arm', 'arm64', 'aarch64'].includes(arch) ? 'arm' : 'amd';
}

function getFilesForArchitecture(architecture) {
  const baseFiles = architecture === 'arm'
    ? [
        { filePath: BIN.web, fileUrl: 'https://arm64.ssss.nyc.mn/sb' },
        { filePath: BIN.bot, fileUrl: 'https://arm64.ssss.nyc.mn/bot' },
      ]
    : [
        { filePath: BIN.web, fileUrl: 'https://amd64.ssss.nyc.mn/sb' },
        { filePath: BIN.bot, fileUrl: 'https://amd64.ssss.nyc.mn/bot' },
      ];

  if (NEZHA_SERVER && NEZHA_KEY) {
    if (NEZHA_PORT) {
      baseFiles.unshift({
        filePath: BIN.npm,
        fileUrl: architecture === 'arm' ? 'https://arm64.ssss.nyc.mn/agent' : 'https://amd64.ssss.nyc.mn/agent',
      });
    } else {
      baseFiles.unshift({
        filePath: BIN.php,
        fileUrl: architecture === 'arm' ? 'https://arm64.ssss.nyc.mn/v1' : 'https://amd64.ssss.nyc.mn/v1',
      });
    }
  }

  return baseFiles;
}

function cleanupOldFiles() {
  const keep = new Set(['sub.txt', 'key.txt', 'private.key', 'cert.pem']);

  try {
    const files = fs.readdirSync(FILE_PATH);
    for (const file of files) {
      const fullPath = path.join(FILE_PATH, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && !keep.has(file)) {
          fs.unlinkSync(fullPath);
        }
      } catch (_) {}
    }
  } catch (_) {}
}

function cleanFilesLater() {
  setTimeout(() => {
    const deleteList = [
      PATHS.bootLog,
      PATHS.list,
      PATHS.config,
      PATHS.nezhaConfig,
      PATHS.tunnelJson,
      PATHS.tunnelYaml,
      BIN.web,
      BIN.bot,
      BIN.php,
      BIN.npm,
    ];

    for (const filePath of deleteList) {
      try {
        fs.unlinkSync(filePath);
      } catch (_) {}
    }

    console.log('Temporary files cleaned');
  }, 90_000);
}

function isArgoJson(auth) {
  return String(auth || '').includes('TunnelSecret');
}

function isArgoToken(auth) {
  return /^[A-Za-z0-9=._-]{120,250}$/.test(String(auth || '').trim());
}

function prepareArgoFiles() {
  if (DISABLE_ARGO) {
    console.log('DISABLE_ARGO=true, skip argo tunnel');
    return;
  }

  if (!ARGO_AUTH || !ARGO_DOMAIN) {
    console.log('ARGO_DOMAIN or ARGO_AUTH is empty, use quick tunnel');
    return;
  }

  if (isArgoJson(ARGO_AUTH)) {
    writeFileSafe(PATHS.tunnelJson, ARGO_AUTH);

    const match = ARGO_AUTH.match(/"TunnelID"\s*:\s*"([^"]+)"/i);
    const tunnelId = match ? match[1] : ARGO_AUTH.split('"')[11] || '';

    const tunnelYaml = [
      `tunnel: ${tunnelId}`,
      `credentials-file: ${PATHS.tunnelJson}`,
      'protocol: http2',
      '',
      'ingress:',
      `  - hostname: ${ARGO_DOMAIN}`,
      `    service: http://localhost:${ARGO_PORT}`,
      '    originRequest:',
      '      noTLSVerify: true',
      '  - service: http_status:404',
      '',
    ].join('\n');

    writeFileSafe(PATHS.tunnelYaml, tunnelYaml);
  } else {
    console.log('ARGO_AUTH is not json, token mode or quick tunnel mode will be used');
  }
}

async function deleteNodes() {
  if (!UPLOAD_URL || !fs.existsSync(PATHS.sub)) return;

  try {
    const fileContent = readIfExists(PATHS.sub).trim();
    if (!fileContent) return;

    let decoded = fileContent;
    try {
      decoded = Buffer.from(fileContent, 'base64').toString('utf8');
    } catch (_) {}

    const nodes = decoded
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /(vless|vmess|trojan|hysteria2|tuic|anytls|socks):\/\//.test(line));

    if (nodes.length === 0) return;

    await axios.post(
      `${UPLOAD_URL}/api/delete-nodes`,
      { nodes },
      {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
      },
    ).catch(() => null);
  } catch (_) {}
}

function loadSavedKeyPair() {
  const content = readIfExists(PATHS.key);
  if (!content) return false;

  const privateKeyMatch = content.match(/PrivateKey:\s*(.*)/);
  const publicKeyMatch = content.match(/PublicKey:\s*(.*)/);
  privateKey = privateKeyMatch ? privateKeyMatch[1].trim() : '';
  publicKey = publicKeyMatch ? publicKeyMatch[1].trim() : '';
  return Boolean(privateKey && publicKey);
}

function generateKeyPairByBinary() {
  if (!fs.existsSync(BIN.web)) {
    throw new Error('web binary not found');
  }

  const result = spawnSync(BIN.web, ['generate', 'reality-keypair'], {
    encoding: 'utf8',
    timeout: 20000,
  });

  if (result.error) {
    throw result.error;
  }

  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const privateKeyMatch = output.match(/PrivateKey:\s*(.*)/);
  const publicKeyMatch = output.match(/PublicKey:\s*(.*)/);

  privateKey = privateKeyMatch ? privateKeyMatch[1].trim() : '';
  publicKey = publicKeyMatch ? publicKeyMatch[1].trim() : '';

  if (!privateKey || !publicKey) {
    throw new Error('Failed to extract private/public key from generated output');
  }

  writeFileSafe(PATHS.key, `PrivateKey: ${privateKey}\nPublicKey: ${publicKey}\n`);
}

function ensureKeyPair() {
  const needReality = isValidPort(REALITY_PORT) || isValidPort(ANYREALITY_PORT);
  if (!needReality) return;

  if (loadSavedKeyPair()) return;
  generateKeyPairByBinary();
}

function ensureTlsFiles() {
  if (fs.existsSync(PATHS.privateKey) && fs.existsSync(PATHS.cert)) {
    return;
  }

  if (commandExists('openssl')) {
    const ec = spawnSync('openssl', ['ecparam', '-genkey', '-name', 'prime256v1', '-out', PATHS.privateKey], {
      encoding: 'utf8',
      timeout: 20000,
    });
    if (ec.error || ec.status !== 0) {
      throw new Error(`openssl ecparam failed: ${(ec.stderr || ec.error?.message || '').trim()}`);
    }

    const cert = spawnSync(
      'openssl',
      ['req', '-new', '-x509', '-days', '3650', '-key', PATHS.privateKey, '-out', PATHS.cert, '-subj', '/CN=bing.com'],
      { encoding: 'utf8', timeout: 20000 },
    );

    if (cert.error || cert.status !== 0) {
      throw new Error(`openssl req failed: ${(cert.stderr || cert.error?.message || '').trim()}`);
    }

    return;
  }

  writeFileSafe(
    PATHS.privateKey,
    `-----BEGIN EC PARAMETERS-----
BggqhkjOPQMBBw==
-----END EC PARAMETERS-----
-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIM4792SEtPqIt1ywqTd/0bYidBqpYV/++siNnfBYsdUYoAoGCCqGSM49
AwEHoUQDQgAE1kHafPj07rJG+HboH2ekAI4r+e6TL38GWASANnngZreoQDF16ARa
/TsyLyFoPkhLxSbehH/NBEjHtSZGaDhMqQ==
-----END EC PRIVATE KEY-----`,
  );

  writeFileSafe(
    PATHS.cert,
    `-----BEGIN CERTIFICATE-----
MIIBejCCASGgAwIBAgIUfWeQL3556PNJLp/veCFxGNj9crkwCgYIKoZIzj0EAwIw
EzERMA8GA1UEAwwIYmluZy5jb20wHhcNMjUwOTE4MTgyMDIyWhcNMzUwOTE2MTgy
MDIyWjATMREwDwYDVQQDDAhiaW5nLmNvbTBZMBMGByqGSM49AgEGCCqGSM49AwEH
A0IABNZB2nz49O6yRvh26B9npACOK/nuky9/BlgEgDZ54Ga3qEAxdegEWv07Mi8h
aD5IS8Um3oR/zQRIx7UmRmg4TKmjUzBRMB0GA1UdDgQWBBTV1cFID7UISE7PLTBR
BfGbgkrMNzAfBgNVHSMEGDAWgBTV1cFID7UISE7PLTBRBfGbgkrMNzAPBgNVHRMB
Af8EBTADAQH/MAoGCCqGSM49BAMCA0cAMEQCIAIDAJvg0vd/ytrQVvEcSm6XTlB+
eQ6OFb9LbLYL9f+sAiAffoMbi4y/0YUSlTtz7as9S8/lciBF5VCUoVIKS+vX2g==
-----END CERTIFICATE-----`,
  );
}

function getNezhaTlsFlag() {
  const tlsPorts = new Set(['443', '8443', '2096', '2087', '2083', '2053']);
  const portFromServer = NEZHA_SERVER.includes(':') ? NEZHA_SERVER.split(':').pop() : '';
  const port = NEZHA_PORT || portFromServer;
  return tlsPorts.has(String(port));
}

function getPublicIp() {
  try {
    const value = execSync('curl -sm 3 ipv4.ip.sb', { encoding: 'utf8' }).trim();
    if (value) return value;
  } catch (_) {}

  try {
    const value = execSync('curl -sm 3 ipv6.ip.sb', { encoding: 'utf8' }).trim();
    if (value) return `[${value}]`;
  } catch (_) {}

  return '';
}

async function getMetaInfo() {
  try {
    const response = await axios.get('https://api.ip.sb/geoip', {
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    if (response.data?.country_code && response.data?.isp) {
      return `${response.data.country_code}-${response.data.isp}`.replace(/\s+/g, '_');
    }
  } catch (_) {}

  try {
    const response = await axios.get('http://ip-api.com/json', {
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    if (response.data?.status === 'success' && response.data?.countryCode && response.data?.org) {
      return `${response.data.countryCode}-${response.data.org}`.replace(/\s+/g, '_');
    }
  } catch (_) {}

  return 'Unknown';
}

function youtubeNeedsWarp() {
  if (YT_WARPOUT) return true;

  try {
    const status = execSync('curl -o /dev/null -m 2 -s -w "%{http_code}" https://www.youtube.com', {
      encoding: 'utf8',
    }).trim();
    return status !== '200';
  } catch (error) {
    try {
      const fallback = error?.output?.[1]?.toString().trim();
      return fallback !== '200';
    } catch (_) {
      return true;
    }
  }
}

function buildSingboxConfig() {
  const config = {
    log: {
      disabled: true,
      level: 'error',
      timestamp: true,
    },
    inbounds: [
      {
        tag: 'vmess-ws-in',
        type: 'vmess',
        listen: '::',
        listen_port: ARGO_PORT,
        users: [{ uuid: UUID }],
        transport: {
          type: 'ws',
          path: '/vmess-argo',
          early_data_header_name: 'Sec-WebSocket-Protocol',
        },
      },
    ],
    endpoints: [
      {
        type: 'wireguard',
        tag: 'wireguard-out',
        mtu: 1280,
        address: [
          '172.16.0.2/32',
          '2606:4700:110:8dfe:d141:69bb:6b80:925/128',
        ],
        private_key: 'YFYOAdbw1bKTHlNNi+aEjBM3BO7unuFC5rOkMRAz9XY=',
        peers: [
          {
            address: 'engage.cloudflareclient.com',
            port: 2408,
            public_key: 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=',
            allowed_ips: ['0.0.0.0/0', '::/0'],
            reserved: [78, 135, 76],
          },
        ],
      },
    ],
    outbounds: [{ type: 'direct', tag: 'direct' }],
    route: {
      rule_set: [
        {
          tag: 'netflix',
          type: 'remote',
          format: 'binary',
          url: 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geosite/netflix.srs',
          download_detour: 'direct',
        },
        {
          tag: 'openai',
          type: 'remote',
          format: 'binary',
          url: 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geosite/openai.srs',
          download_detour: 'direct',
        },
      ],
      rules: [
        {
          rule_set: ['openai', 'netflix'],
          outbound: 'wireguard-out',
        },
      ],
      final: 'direct',
    },
  };

  if (isValidPort(REALITY_PORT)) {
    config.inbounds.push({
      tag: 'vless-in',
      type: 'vless',
      listen: '::',
      listen_port: Number(REALITY_PORT),
      users: [{ uuid: UUID, flow: 'xtls-rprx-vision' }],
      tls: {
        enabled: true,
        server_name: 'www.iij.ad.jp',
        reality: {
          enabled: true,
          handshake: { server: 'www.iij.ad.jp', server_port: 443 },
          private_key: privateKey,
          short_id: [''],
        },
      },
    });
  }

  if (isValidPort(HY2_PORT)) {
    config.inbounds.push({
      tag: 'hysteria-in',
      type: 'hysteria2',
      listen: '::',
      listen_port: Number(HY2_PORT),
      users: [{ password: UUID }],
      masquerade: 'https://bing.com',
      tls: {
        enabled: true,
        alpn: ['h3'],
        certificate_path: PATHS.cert,
        key_path: PATHS.privateKey,
      },
    });
  }

  if (isValidPort(TUIC_PORT)) {
    config.inbounds.push({
      tag: 'tuic-in',
      type: 'tuic',
      listen: '::',
      listen_port: Number(TUIC_PORT),
      users: [{ uuid: UUID }],
      congestion_control: 'bbr',
      tls: {
        enabled: true,
        alpn: ['h3'],
        certificate_path: PATHS.cert,
        key_path: PATHS.privateKey,
      },
    });
  }

  if (isValidPort(S5_PORT)) {
    config.inbounds.push({
      tag: 's5-in',
      type: 'socks',
      listen: '::',
      listen_port: Number(S5_PORT),
      users: [{
        username: UUID.substring(0, 8),
        password: UUID.slice(-12),
      }],
    });
  }

  if (isValidPort(ANYTLS_PORT)) {
    config.inbounds.push({
      tag: 'anytls-in',
      type: 'anytls',
      listen: '::',
      listen_port: Number(ANYTLS_PORT),
      users: [{ password: UUID }],
      tls: {
        enabled: true,
        certificate_path: PATHS.cert,
        key_path: PATHS.privateKey,
      },
    });
  }

  if (isValidPort(ANYREALITY_PORT)) {
    config.inbounds.push({
      tag: 'anyreality-in',
      type: 'anytls',
      listen: '::',
      listen_port: Number(ANYREALITY_PORT),
      users: [{ password: UUID }],
      tls: {
        enabled: true,
        server_name: 'www.iij.ad.jp',
        reality: {
          enabled: true,
          handshake: { server: 'www.iij.ad.jp', server_port: 443 },
          private_key: privateKey,
          short_id: [''],
        },
      },
    });
  }

  if (youtubeNeedsWarp()) {
    config.route.rule_set.push({
      tag: 'youtube',
      type: 'remote',
      format: 'binary',
      url: 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geosite/youtube.srs',
      download_detour: 'direct',
    });

    const wireguardRule = config.route.rules.find((rule) => rule.outbound === 'wireguard-out');
    if (wireguardRule && Array.isArray(wireguardRule.rule_set)) {
      if (!wireguardRule.rule_set.includes('youtube')) {
        wireguardRule.rule_set.push('youtube');
      }
    } else {
      config.route.rules.push({
        rule_set: ['openai', 'netflix', 'youtube'],
        outbound: 'wireguard-out',
      });
    }

    console.log('Add YouTube outbound rule');
  }

  return config;
}

async function spawnDetached(binaryPath, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      cwd: FILE_PATH,
      stdio: 'ignore',
      detached: true,
    });

    let settled = false;

    child.once('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        child.unref();
        console.log(`${label} is running`);
        resolve(child);
      }
    }, 300);
  });
}

function killDetached(child) {
  if (!child?.pid) return;

  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch (_) {
    try {
      child.kill('SIGTERM');
    } catch (_) {}
  }
}

async function startNezhaIfNeeded() {
  if (!(NEZHA_SERVER && NEZHA_KEY)) {
    console.log('NEZHA variables are empty, skipping nezha');
    return;
  }

  if (NEZHA_PORT) {
    const args = [
      '-s', `${NEZHA_SERVER}:${NEZHA_PORT}`,
      '-p', NEZHA_KEY,
      ...(getNezhaTlsFlag() ? ['--tls'] : []),
      '--disable-auto-update',
      '--report-delay', '4',
      '--skip-conn',
      '--skip-procs',
    ];

    children.nezha = await spawnDetached(BIN.npm, args, 'nezha-agent');
    await sleep(1000);
    return;
  }

  const configYaml = [
    `client_secret: ${NEZHA_KEY}`,
    'debug: false',
    'disable_auto_update: true',
    'disable_command_execute: false',
    'disable_force_update: true',
    'disable_nat: false',
    'disable_send_query: false',
    'gpu: false',
    'insecure_tls: true',
    'ip_report_period: 1800',
    'report_delay: 4',
    `server: ${NEZHA_SERVER}`,
    'skip_connection_count: true',
    'skip_procs_count: true',
    'temperature: false',
    `tls: ${getNezhaTlsFlag() ? 'true' : 'false'}`,
    'use_gitee_to_upgrade: false',
    'use_ipv6_country_code: false',
    `uuid: ${UUID}`,
    '',
  ].join('\n');

  writeFileSafe(PATHS.nezhaConfig, configYaml);
  children.nezha = await spawnDetached(BIN.php, ['-c', PATHS.nezhaConfig], 'nezha-v1');
  await sleep(1000);
}

async function startSingbox() {
  const config = buildSingboxConfig();
  writeFileSafe(PATHS.config, JSON.stringify(config, null, 2));
  children.web = await spawnDetached(BIN.web, ['run', '-c', PATHS.config], 'sing-box');
  await sleep(1000);
}

async function startCloudflared(mode = 'auto') {
  if (DISABLE_ARGO) {
    console.log('Argo disabled, skip cloudflared');
    return null;
  }

  let args = null;

  if (mode === 'quick') {
    args = [
      'tunnel',
      '--edge-ip-version', 'auto',
      '--no-autoupdate',
      '--protocol', 'http2',
      '--logfile', PATHS.bootLog,
      '--loglevel', 'info',
      '--url', `http://localhost:${ARGO_PORT}`,
    ];
  } else if (ARGO_AUTH && isArgoToken(ARGO_AUTH)) {
    args = [
      'tunnel',
      '--edge-ip-version', 'auto',
      '--no-autoupdate',
      '--protocol', 'http2',
      'run',
      '--token', ARGO_AUTH,
    ];
  } else if (ARGO_AUTH && ARGO_DOMAIN && isArgoJson(ARGO_AUTH)) {
    args = [
      'tunnel',
      '--edge-ip-version', 'auto',
      '--config', PATHS.tunnelYaml,
      'run',
    ];
  } else {
    args = [
      'tunnel',
      '--edge-ip-version', 'auto',
      '--no-autoupdate',
      '--protocol', 'http2',
      '--logfile', PATHS.bootLog,
      '--loglevel', 'info',
      '--url', `http://localhost:${ARGO_PORT}`,
    ];
  }

  children.bot = await spawnDetached(BIN.bot, args, 'cloudflared');
  return children.bot;
}

function parseTryCloudflareDomain(logContent) {
  if (!logContent) return '';
  const match = logContent.match(/https?:\/\/([^\s]*trycloudflare\.com)\/?/i);
  return match ? match[1] : '';
}

async function resolveArgoDomain() {
  if (DISABLE_ARGO) {
    return '';
  }

  if (ARGO_AUTH && ARGO_DOMAIN) {
    return ARGO_DOMAIN;
  }

  for (let round = 0; round < 2; round += 1) {
    for (let i = 0; i < 10; i += 1) {
      const domain = parseTryCloudflareDomain(readIfExists(PATHS.bootLog));
      if (domain) return domain;
      await sleep(3000);
    }

    if (round === 0) {
      console.log('Argo domain not found, restarting quick tunnel once');
      killDetached(children.bot);
      children.bot = null;
      try {
        fs.unlinkSync(PATHS.bootLog);
      } catch (_) {}
      await startCloudflared('quick');
    }
  }

  return '';
}

async function generateLinks(argoDomain = '') {
  const serverIp = getPublicIp() || CFIP;
  const isp = await getMetaInfo();
  const nodeName = NAME ? `${NAME}-${isp}` : isp;
  const lines = [];

  if (!DISABLE_ARGO && argoDomain) {
    const vmessNode = `vmess://${Buffer.from(JSON.stringify({
      v: '2',
      ps: nodeName,
      add: CFIP,
      port: String(CFPORT),
      id: UUID,
      aid: '0',
      scy: 'auto',
      net: 'ws',
      type: 'none',
      host: argoDomain,
      path: '/vmess-argo?ed=2560',
      tls: 'tls',
      sni: argoDomain,
      alpn: '',
      fp: 'firefox',
    })).toString('base64')}`;

    lines.push(vmessNode);
  }

  if (isValidPort(TUIC_PORT)) {
    lines.push(`tuic://${UUID}:@${serverIp}:${TUIC_PORT}?sni=www.bing.com&congestion_control=bbr&udp_relay_mode=native&alpn=h3&allow_insecure=1#${nodeName}`);
  }

  if (isValidPort(HY2_PORT)) {
    lines.push(`hysteria2://${UUID}@${serverIp}:${HY2_PORT}/?sni=www.bing.com&insecure=1&alpn=h3&obfs=none#${nodeName}`);
  }

  if (isValidPort(REALITY_PORT) && publicKey) {
    lines.push(`vless://${UUID}@${serverIp}:${REALITY_PORT}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.iij.ad.jp&fp=firefox&pbk=${publicKey}&type=tcp&headerType=none#${nodeName}`);
  }

  if (isValidPort(ANYTLS_PORT)) {
    lines.push(`anytls://${UUID}@${serverIp}:${ANYTLS_PORT}?security=tls&sni=${serverIp}&fp=chrome&insecure=1&allowInsecure=1#${nodeName}`);
  }

  if (isValidPort(ANYREALITY_PORT) && publicKey) {
    lines.push(`anytls://${UUID}@${serverIp}:${ANYREALITY_PORT}?security=reality&sni=www.iij.ad.jp&fp=chrome&pbk=${publicKey}&type=tcp&headerType=none#${nodeName}`);
  }

  if (isValidPort(S5_PORT)) {
    const auth = Buffer.from(`${UUID.substring(0, 8)}:${UUID.slice(-12)}`).toString('base64');
    lines.push(`socks://${auth}@${serverIp}:${S5_PORT}#${nodeName}`);
  }

  const plainText = lines.join('\n');
  const base64Text = Buffer.from(plainText).toString('base64');

  state.argoDomain = argoDomain;
  state.listText = plainText;
  state.subBase64 = base64Text;
  state.ready = true;

  writeFileSafe(PATHS.list, plainText);
  writeFileSafe(PATHS.sub, base64Text);

  console.log('\x1b[32m' + base64Text + '\x1b[0m');
  console.log('\x1b[35mLogs will be deleted in 90 seconds, you can copy the above nodes\x1b[0m');
}

async function sendTelegram() {
  if (!BOT_TOKEN || !CHAT_ID || !state.subBase64) {
    return;
  }

  try {
    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        chat_id: CHAT_ID,
        text: `${NAME || 'node'} 节点推送通知\n\n${state.subBase64}`,
      },
      { timeout: 10000 },
    );

    console.log('Telegram message sent successfully');
  } catch (error) {
    console.error('Failed to send Telegram message:', error.message);
  }
}

async function uploadNodes() {
  if (!UPLOAD_URL || !state.listText) return;

  try {
    if (PROJECT_URL) {
      await axios.post(
        `${UPLOAD_URL}/api/add-subscriptions`,
        { subscription: [buildProjectSubUrl()] },
        {
          timeout: 10000,
          headers: { 'Content-Type': 'application/json' },
        },
      );
      console.log('Subscription uploaded successfully');
      return;
    }

    const nodes = state.listText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /(vless|vmess|trojan|hysteria2|tuic|anytls|socks):\/\//.test(line));

    if (nodes.length === 0) return;

    await axios.post(
      `${UPLOAD_URL}/api/add-nodes`,
      { nodes },
      {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    console.log('Nodes uploaded successfully');
  } catch (error) {
    console.error('Upload nodes failed:', error.message);
  }
}

async function addVisitTask() {
  if (!AUTO_ACCESS || !PROJECT_URL) {
    console.log('Skipping automatic access task');
    return;
  }

  try {
    await axios.post(
      'https://keep.gvrander.eu.org/add-url',
      { url: PROJECT_URL },
      {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    console.log('Automatic access task added successfully');
  } catch (error) {
    console.error(`Add automatic access task failed: ${error.message}`);
  }
}

async function prepareAndRun() {
  const architecture = getSystemArchitecture();
  const files = getFilesForArchitecture(architecture);

  await Promise.all(files.map((item) => downloadFile(item.filePath, item.fileUrl)));
  await ensureExecutable(BIN.web);
  await ensureExecutable(BIN.bot);
  await ensureExecutable(BIN.npm);
  await ensureExecutable(BIN.php);

  ensureKeyPair();
  if (isValidPort(HY2_PORT) || isValidPort(TUIC_PORT) || isValidPort(ANYTLS_PORT) || isValidPort(ANYREALITY_PORT)) {
    ensureTlsFiles();
  }

  await startNezhaIfNeeded();
  await startSingbox();

  if (!DISABLE_ARGO) {
    await startCloudflared();
    await sleep(5000);
  }

  const argoDomain = await resolveArgoDomain();
  if (!DISABLE_ARGO && !argoDomain && !(ARGO_AUTH && ARGO_DOMAIN)) {
    console.log('Quick tunnel domain not found, only direct nodes will be generated');
  }

  await generateLinks(argoDomain);
  await sendTelegram();
  await uploadNodes();
}

async function startServer() {
  if (state.initializing || state.initialized) return;
  state.initializing = true;

  try {
    prepareArgoFiles();
    await deleteNodes();
    cleanupOldFiles();
    await prepareAndRun();
    await addVisitTask();
    cleanFilesLater();
    state.initialized = true;
    state.lastError = '';
  } catch (error) {
    state.lastError = error?.stack || error?.message || String(error);
    console.error('Error in startServer:', state.lastError);
  } finally {
    state.initializing = false;
  }
}

app.get('/health', (_req, res) => {
  res.status(200).send('ok');
});

app.get(`/${SUB_PATH}`, (_req, res) => {
  const content = state.subBase64 || readIfExists(PATHS.sub);
  if (!content) {
    res.status(503).type('text/plain; charset=utf-8').send('Subscription is not ready yet.');
    return;
  }

  res.type('text/plain; charset=utf-8').send(content);
});

app.get('/', async (_req, res) => {
  try {
    const htmlPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(htmlPath)) {
      res.send(await fs.promises.readFile(htmlPath, 'utf8'));
      return;
    }
  } catch (_) {}

  const projectSubUrl = buildProjectSubUrl();
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NodeJS Railway</title>
</head>
<body>
  <h2>服务已启动</h2>
  <p>健康检查：<code>/health</code></p>
  <p>订阅路径：<code>/${escapeHtml(SUB_PATH)}</code></p>
  <p>状态：<strong>${state.ready ? '已就绪' : '初始化中'}</strong></p>
  ${projectSubUrl ? `<p>订阅完整地址：<code>${escapeHtml(projectSubUrl)}</code></p>` : ''}
  ${state.lastError ? `<pre>${escapeHtml(state.lastError)}</pre>` : ''}
</body>
</html>`;

  res.type('html').send(html);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`server is running on port:${PORT}!`);
  startServer().catch((error) => {
    state.lastError = error?.stack || error?.message || String(error);
    console.error('Unhandled startup error:', state.lastError);
  });
});

function shutdown() {
  killDetached(children.bot);
  killDetached(children.web);
  killDetached(children.nezha);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
