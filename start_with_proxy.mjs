/**
 * start_with_proxy.mjs — dev-only helper
 * Configures undici ProxyAgent so that globalThis.fetch uses the VPN proxy,
 * then launches the mock server.
 *
 * Usage: node start_with_proxy.mjs [proxy_url]
 * Default proxy: http://127.0.0.1:51081
 */
import { ProxyAgent, setGlobalDispatcher } from 'undici';

const proxyUrl = process.argv[2] || process.env.HTTPS_PROXY || 'http://127.0.0.1:51081';
console.log(`[proxy-boot] Setting global fetch proxy: ${proxyUrl}`);
setGlobalDispatcher(new ProxyAgent(proxyUrl));

await import('./OppRadar/mock_server_53122.mjs');
