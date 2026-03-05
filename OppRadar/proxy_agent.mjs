// OppRadar/proxy_agent.mjs
// 读取 HTTP_PROXY/HTTPS_PROXY 环境变量，注入 undici 全局 dispatcher
// 使所有原生 fetch() 调用自动走代理

import { ProxyAgent, setGlobalDispatcher } from 'undici';

const proxyUrl = process.env.HTTPS_PROXY
  || process.env.HTTP_PROXY
  || process.env.https_proxy
  || process.env.http_proxy
  || '';

if (proxyUrl) {
  const agent = new ProxyAgent(proxyUrl);
  setGlobalDispatcher(agent);
  console.log(`[proxy] Global proxy set: ${proxyUrl}`);
} else {
  console.log('[proxy] No proxy configured, using direct connection.');
}

export const proxyConfigured = !!proxyUrl;
export const proxyUrl_ = proxyUrl;
