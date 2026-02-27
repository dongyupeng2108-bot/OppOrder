/**
 * rank_v2_provider.mjs
 * Stage0-T2: Provider Interface骨架
 *
 * 对外暴露统一接口 getRankV2Score(oppId, provider)
 * 返回 { p_llm, provider_used, fallback }
 */

import crypto from 'crypto';

/**
 * 确定性mock评分（同oppId必出同结果）
 */
function getDeterministicP(id) {
    const hash = crypto.createHash('sha256').update(id).digest('hex');
    const intVal = parseInt(hash.substring(0, 8), 16);
    return parseFloat((intVal / 0xFFFFFFFF).toFixed(4));
}

/**
 * mock provider
 */
async function scoreMock(oppId) {
    return {
        p_llm: getDeterministicP(oppId),
        provider_used: 'mock',
        fallback: false,
    };
}

/**
 * deepseek provider（当前为fallback骨架，TODO: 接入真实API）
 */
async function scoreDeepseek(oppId) {
    if (!process.env.DEEPSEEK_API_KEY) {
        return {
            p_llm: getDeterministicP(oppId),
            provider_used: 'mock',
            fallback: true,
        };
    }
    // TODO: 真实DeepSeek调用
    // 暂时fallback到mock
    return {
        p_llm: getDeterministicP(oppId),
        provider_used: 'mock',
        fallback: true,
    };
}

/**
 * 统一入口
 * @param {string} oppId
 * @param {string} provider - 'mock' | 'deepseek'
 * @returns {{ p_llm: number, provider_used: string, fallback: boolean }}
 */
export async function getRankV2Score(oppId, provider = 'mock') {
    switch (provider) {
        case 'deepseek':
            return scoreDeepseek(oppId);
        case 'mock':
        default:
            return scoreMock(oppId);
    }
}
