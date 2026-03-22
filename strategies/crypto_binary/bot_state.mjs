const createDefaultState = (mode = 'paper-staging') => ({
  mode,
  phase: 'IDLE',
  current_window_id: null,
  remaining_sec: null,
  anchor_btc: null,
  atr_5m: null,
  upper_bound: null,
  lower_bound: null,
  ladder_posted: false,
  yes_order_ids: [],
  no_order_ids: [],
  updated_at: new Date().toISOString()
});

const normalizeState = (input = {}) => ({
  mode: input.mode ?? 'paper-staging',
  phase: input.phase ?? 'IDLE',
  current_window_id: input.current_window_id ?? null,
  remaining_sec: input.remaining_sec ?? null,
  anchor_btc: input.anchor_btc ?? null,
  atr_5m: input.atr_5m ?? null,
  upper_bound: input.upper_bound ?? null,
  lower_bound: input.lower_bound ?? null,
  ladder_posted: input.ladder_posted === true,
  yes_order_ids: Array.isArray(input.yes_order_ids) ? input.yes_order_ids : [],
  no_order_ids: Array.isArray(input.no_order_ids) ? input.no_order_ids : [],
  updated_at: input.updated_at || new Date().toISOString()
});

export function createBotStateStore(options = {}) {
  let state = normalizeState(createDefaultState(options.mode || 'paper-staging'));

  const getState = () => ({ ...state });

  const patchState = (patch = {}) => {
    state = normalizeState({
      ...state,
      ...patch,
      updated_at: new Date().toISOString()
    });
    return { ...state };
  };

  return { getState, patchState };
}
