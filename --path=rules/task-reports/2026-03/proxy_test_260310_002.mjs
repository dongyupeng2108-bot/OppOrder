--content=import { ProxyAgent, fetch as uFetch } from 'undici';
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (\!proxy) { console.log('NO_PROXY_ENV'); process.exit(1); }
console.log('proxy:', proxy);
try {
  const dispatcher = new ProxyAgent(proxy);
  const res = await uFetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', { dispatcher });
  console.log('WITH_PROXY status:', res.status);
  if (res.ok) { const d = await res.json(); console.log('price:', d.price); }
} catch(e) { console.error('WITH_PROXY error:', e.message); }
try {
  const res2 = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
  console.log('WITHOUT_PROXY status:', res2.status);
} catch(e) { console.error('WITHOUT_PROXY error:', e.message); }
