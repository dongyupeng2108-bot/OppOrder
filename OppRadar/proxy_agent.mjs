// OppRadar/proxy_agent.mjs
// 读取 HTTP_PROXY/HTTPS_PROXY 环境变量，注入 undici 全局 dispatcher
// 使所有原生 fetch() 调用自动走代理

let _proxyConfigured = false;
let _proxyUrl = '';

const proxyUrl = process.env.HTTPS_PROXY
  || process.env.HTTP_PROXY
  || process.env.https_proxy
  || process.env.http_proxy
  || '';

if (proxyUrl) {
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import('undici');
    const agent = new ProxyAgent(proxyUrl);
    setGlobalDispatcher(agent);
    _proxyConfigured = true;
    _proxyUrl = proxyUrl;
    console.log(`[proxy] Global proxy set: ${proxyUrl}`);
  } catch (err) {
    console.warn(`[proxy] undici not available (${err.message}), proxy not set.`);
  }
} else {
  console.log('[proxy] No proxy configured, using direct connection.');
}

export const proxyConfigured = _proxyConfigured;
export const proxyUrl_ = _proxyUrl;
