const createDefaultState = (mode = 'paper-staging') => ({
  mode,
  phase: 'IDLE',
  running: false,
  debug_scenario: null,
  debug_frame_index: 0,
  debug_completed: false,
  tick_interval_ms: 2000,
  last_tick_at: null,
  last_window_id: null,
  current_window_id: null,
  window_initialized_at: null,
  remaining_sec: null,
  anchor_btc: null,
  atr_5m: null,
  upper_bound: null,
  lower_bound: null,
  ladder_posted: false,
  yes_cancelled: false,
  no_cancelled: false,
  yes_order_ids: [],
  no_order_ids: [],
  last_reason: null,
  last_intents: [],
  updated_at: new Date().toISOString()
});

const normalizeState = (input = {}) => ({
  mode: input.mode ?? 'paper-staging',
  phase: input.phase ?? 'IDLE',
  running: input.running === true,
  debug_scenario: typeof input.debug_scenario === 'string' ? input.debug_scenario : null,
  debug_frame_index: Number.isFinite(Number(input.debug_frame_index)) ? Number(input.debug_frame_index) : 0,
  debug_completed: input.debug_completed === true,
  tick_interval_ms: Number.isFinite(Number(input.tick_interval_ms)) ? Number(input.tick_interval_ms) : 2000,
  last_tick_at: typeof input.last_tick_at === 'string' ? input.last_tick_at : null,
  last_window_id: input.last_window_id ?? null,
  current_window_id: input.current_window_id ?? null,
  window_initialized_at: typeof input.window_initialized_at === 'string' ? input.window_initialized_at : null,
  remaining_sec: input.remaining_sec ?? null,
  anchor_btc: input.anchor_btc ?? null,
  atr_5m: input.atr_5m ?? null,
  upper_bound: input.upper_bound ?? null,
  lower_bound: input.lower_bound ?? null,
  ladder_posted: input.ladder_posted === true,
  yes_cancelled: input.yes_cancelled === true,
  no_cancelled: input.no_cancelled === true,
  yes_order_ids: Array.isArray(input.yes_order_ids) ? input.yes_order_ids : [],
  no_order_ids: Array.isArray(input.no_order_ids) ? input.no_order_ids : [],
  last_reason: typeof input.last_reason === 'string' ? input.last_reason : null,
  last_intents: Array.isArray(input.last_intents) ? input.last_intents : [],
  updated_at: input.updated_at || new Date().toISOString()
});

const toFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

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

  const createWindowResetPatch = (nextWindowId) => ({
    last_window_id: state.current_window_id ?? null,
    current_window_id: nextWindowId ?? null,
    window_initialized_at: null,
    ladder_posted: false,
    yes_order_ids: [],
    no_order_ids: [],
    yes_cancelled: false,
    no_cancelled: false,
    anchor_btc: null,
    atr_5m: null,
    upper_bound: null,
    lower_bound: null,
    phase: 'WAIT_WINDOW_INIT'
  });

  const createWindowInitPatch = ({ window_id, btc_price, atr_5m, atr_multiplier }) => {
    const anchor = toFiniteNumber(btc_price);
    const atr = toFiniteNumber(atr_5m);
    const mult = toFiniteNumber(atr_multiplier);
    if (window_id == null || anchor == null || atr == null || mult == null) {
      return {
        current_window_id: window_id ?? state.current_window_id ?? null,
        anchor_btc: null,
        atr_5m: atr,
        upper_bound: null,
        lower_bound: null,
        phase: 'WAIT_WINDOW_INIT'
      };
    }
    const boundDelta = atr * mult;
    return {
      current_window_id: window_id,
      window_initialized_at: new Date().toISOString(),
      anchor_btc: anchor,
      atr_5m: atr,
      upper_bound: anchor + boundDelta,
      lower_bound: anchor - boundDelta,
      phase: 'IDLE'
    };
  };

  return { getState, patchState, createWindowResetPatch, createWindowInitPatch };
}
