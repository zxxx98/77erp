import { request } from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { createHmac } from 'node:crypto';

const blocked = new BlockList();
for (const [ip, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(ip, prefix);
const publicV6 = new BlockList();
publicV6.addSubnet('2000::', 3, 'ipv6');
blocked.addSubnet('2001::', 23, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');
blocked.addSubnet('3fff::', 20, 'ipv6');

export function isPublicAddress(address) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, 'ipv4') : family === 6 && publicV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}
export function validateWebhookUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请填写有效的 HTTPS Webhook 地址。'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x20\x7f]/.test(value) || url.protocol !== 'https:' || url.username || url.password || url.hash ||
      host === 'localhost' || host.endsWith('.localhost') || (isIP(host) && !isPublicAddress(host)))
    throw new Error('Webhook 需为公网 HTTPS 地址，不支持账号密码、片段或本机／内网地址。');
  return url;
}

export function webhookRequest(config, event, timestamp = Date.now()) {
  const url = validateWebhookUrl(config.url);
  // Group robot text limits are byte-based. Keep summaries comfortably below 2 KB.
  let message = event.message;
  while (Buffer.byteLength(message) > 1800) message = message.slice(0, -40);
  if (message !== event.message) message += '\n…更多内容请在 ERP 中查看';
  let payload = config.format === 'json' ? event : config.format === 'feishu'
    ? { msg_type: 'text', content: { text: message } }
    : { msgtype: 'text', text: { content: message } };
  if (config.secret && config.format === 'dingtalk') {
    url.searchParams.set('timestamp', String(timestamp));
    url.searchParams.set('sign', createHmac('sha256', config.secret).update(`${timestamp}\n${config.secret}`).digest('base64'));
  }
  if (config.secret && config.format === 'feishu') {
    const seconds = String(Math.floor(timestamp / 1000));
    payload = { ...payload, timestamp: seconds, sign: createHmac('sha256', `${seconds}\n${config.secret}`).update('').digest('base64') };
  }
  const body = JSON.stringify(payload);
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-77ERP-Event-ID': event.id, 'X-77ERP-Timestamp': String(timestamp) };
  if (config.secret && config.format === 'json') headers['X-77ERP-Signature'] = `sha256=${createHmac('sha256', config.secret).update(`${timestamp}.${body}`).digest('hex')}`;
  return { url, body, headers };
}

// Resolve and pin the validated address for this request: DNS rebinding and redirects
// must never allow a configured external webhook to access local services.
export async function sendWebhook(config, event, { resolveAddress = lookup, httpsRequest = request } = {}) {
  const { url, body, headers } = webhookRequest(config, event);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let dnsTimer;
  const records = await Promise.race([
    resolveAddress(host, { all: true }),
    new Promise((_, reject) => { dnsTimer = setTimeout(() => reject(new Error('DNS timeout')), 5000); dnsTimer.unref(); }),
  ]).finally(() => clearTimeout(dnsTimer));
  if (!records.length || records.some(record => !isPublicAddress(record.address))) throw new Error('Unsafe destination');
  const selected = records[0];
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      method: 'POST', headers, agent: false, signal: AbortSignal.timeout(10000),
      lookup: (_host, options, callback) => options.all ? callback(null, [selected]) : callback(null, selected.address, selected.family),
    }, res => {
      let size = 0;
      const chunks = [];
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 65536) req.destroy(new Error('Response too large'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('HTTP failure'));
        if (config.format !== 'json') {
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const code = config.format === 'feishu' ? result.code ?? result.StatusCode : result.errcode;
            if (code !== 0) return reject(new Error('Robot rejected message'));
          } catch { return reject(new Error('Invalid robot response')); }
        }
        resolve();
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}
