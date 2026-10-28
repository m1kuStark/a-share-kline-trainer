/**
 * Cross-period / cross-formula reference core (M9-02 patch layer).
 *
 * Frozen semantics (task card M9-02, 2026-10-26):
 * - `"X#WEEK"` on daily bars resamples to natural weeks (Monday start; holiday
 *   weeks aggregate the trading days that actually exist) and broadcasts each
 *   week's value to every daily bar of that week.
 * - The trailing (current) week is aggregated as-of each day when the week is
 *   not finished: within the trailing group, bar i sees the weekly bar built
 *   from that week's days up to and including i (in-week repaint is by design;
 *   evidence: 骑牛买1 comment「WEEKDAY…确保取的是上周五数据」).
 * - Complete weeks each broadcast one value to all of their daily bars.
 * - Months are natural calendar months (same trailing rule).
 * - Builtin indicator references follow TDX MACD convention:
 *   DIF=EMA(C,12)−EMA(C,26), DEA=EMA(DIF,9), histogram=2×(DIF−DEA).
 *
 * Pure functions only: no engine imports here (the Interpreter injects the
 * line-computation callback; FormulaEngine injects the auxiliary registry).
 */
import { MarketData } from './types/MarketData';
import { MACD_DIF, MACD_DEA, MACD_MACD } from './interpreter/functions/indicators';
import type { StockContext } from './marketContext';

/** Supported period suffixes of `#PERIOD` references. */
export type PeriodSuffix = 'DAY' | 'WEEK' | 'MONTH';

/** Periods that require resampling (DAY is the identity mapping). */
export type ResamplePeriod = 'WEEK' | 'MONTH';

export const PERIOD_SUFFIXES: readonly PeriodSuffix[] = ['DAY', 'WEEK', 'MONTH'];

export function isKnownPeriodSuffix(value: string): value is PeriodSuffix {
  return (PERIOD_SUFFIXES as readonly string[]).includes(value.toUpperCase());
}

/** Depth / cycle guard shared across one top-level evaluate call. */
export interface AuxiliaryReferenceState {
  stack: string[];
}

/** Max auxiliary-formula reference depth (root proposed default, M9-02). */
export const AUXILIARY_REFERENCE_DEPTH_LIMIT = 8;

/**
 * Source registry of auxiliary formulas referenced as `"NAME.LINE#PERIOD"`.
 * Convention (workspace rule): auxiliary formula names are pure English.
 */
export type AuxiliaryFormulaRegistry = Map<string, string>;

/** Injectable builtin indicator table; returning undefined defers to the auxiliary registry. */
export interface BuiltinIndicatorProvider {
  getLine(indicator: string, line: string, bars: MarketData[]): number[] | undefined;
}

/** Options of {@link import('./FormulaEngine').FormulaEngine.evaluate}. */
export interface FormulaEvaluationOptions {
  /** Auxiliary formula sources referenced via "NAME.LINE#PERIOD" (Map or plain record). */
  auxiliaryFormulas?: AuxiliaryFormulaRegistry | Record<string, string>;
  /** Builtin indicator provider; defaults to the system TDX-convention table (MACD family). */
  builtinIndicators?: BuiltinIndicatorProvider;
  /** M9-03 patch: market context of the evaluated stock (FINANCE/NAMELIKE/CODELIKE/HYBLOCK/HY_INDEX family). */
  stockContext?: StockContext;
}

/** Resolver injected by FormulaEngine for cross-period / cross-formula references (M9-02). */
export interface CrossPeriodResolver {
  builtinIndicators?: BuiltinIndicatorProvider;
  /** Evaluate a registered auxiliary formula on the given bar series; returns its outputs. */
  evaluateAuxiliary?: (name: string, bars: MarketData[]) => Map<string, number[]>;
}

/** Normalize the auxiliaryFormulas option to a Map (copy: callers may reuse the input). */
export function normalizeAuxiliaryFormulas(
  auxiliary: AuxiliaryFormulaRegistry | Record<string, string> | undefined,
): AuxiliaryFormulaRegistry | undefined {
  if (!auxiliary) return undefined;
  if (auxiliary instanceof Map) return new Map(auxiliary);
  return new Map(Object.entries(auxiliary));
}

/** Aggregate a contiguous run of daily bars into one higher-period bar (TDX convention). */
export function aggregateBars(sub: MarketData[]): MarketData {
  if (sub.length === 0) {
    throw new Error('aggregateBars: cannot aggregate an empty bar group');
  }
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  let amount = 0;
  let hasAmount = false;
  for (const b of sub) {
    if (b.high > high) high = b.high;
    if (b.low < low) low = b.low;
    volume += b.volume;
    if (b.amount !== undefined) {
      amount += b.amount;
      hasAmount = true;
    }
  }
  const first = sub[0];
  const last = sub[sub.length - 1];
  return {
    open: first.open,
    high,
    low,
    close: last.close,
    volume,
    timestamp: first.timestamp,
    amount: hasAmount ? amount : undefined,
    tradableShares: last.tradableShares,
  };
}

/** Grouping key of a bar for the given resample period (local calendar, like datetime functions). */
function groupKey(timestamp: number, period: ResamplePeriod): number {
  const d = new Date(timestamp);
  if (period === 'MONTH') {
    return d.getFullYear() * 12 + d.getMonth();
  }
  // Natural week starting Monday: key = midnight of the week's Monday.
  const offsetFromMonday = (d.getDay() + 6) % 7;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - offsetFromMonday);
  return monday.getTime();
}

export interface ResampledPeriod {
  /** Fully aggregated bar per group (including the trailing group's full aggregation). */
  bars: MarketData[];
  /** groups[k] = ascending daily-bar indices belonging to group k. */
  groups: number[][];
}

/** Resample daily bars into weekly / monthly groups of consecutive bars. */
export function resampleBars(dailyBars: MarketData[], period: ResamplePeriod): ResampledPeriod {
  const bars: MarketData[] = [];
  const groups: number[][] = [];
  let currentKey: number | null = null;
  let currentIndices: number[] = [];

  const flush = () => {
    if (currentIndices.length === 0) return;
    bars.push(aggregateBars(dailyBars.slice(currentIndices[0], currentIndices[currentIndices.length - 1] + 1)));
    groups.push(currentIndices);
    currentIndices = [];
  };

  for (let i = 0; i < dailyBars.length; i++) {
    const key = groupKey(dailyBars[i].timestamp, period);
    if (currentKey === null || key !== currentKey) {
      flush();
      currentKey = key;
    }
    currentIndices.push(i);
  }
  flush();

  return { bars, groups };
}

/**
 * Broadcast a higher-period reference line back onto the daily axis.
 *
 * - DAY: the line computed directly on the daily bars (identity).
 * - WEEK/MONTH: every complete group broadcasts its single line value to all of
 *   its daily bars; the trailing (current) group is aggregated as-of each day,
 *   so bar i within it sees the line computed over [complete groups..., this
 *   week's bars up to i].
 *
 * @param computeLine computes the referenced line over the given bar series
 *   (must be order-preserving / non-lookahead, e.g. EMA family).
 */
export function broadcastReferenceLine(
  dailyBars: MarketData[],
  period: PeriodSuffix,
  computeLine: (bars: MarketData[]) => number[],
): number[] {
  const out: number[] = new Array(dailyBars.length).fill(NaN);
  if (period === 'DAY') {
    return computeLine(dailyBars);
  }

  const { bars, groups } = resampleBars(dailyBars, period);
  if (groups.length === 0) {
    return out;
  }

  const completeCount = groups.length - 1;
  const completeBars = bars.slice(0, completeCount);
  const completeLine = computeLine(completeBars);
  for (let k = 0; k < completeCount; k++) {
    const value = completeLine[k];
    for (const i of groups[k]) {
      out[i] = value;
    }
  }

  const trailing = groups[groups.length - 1];
  for (let j = 0; j < trailing.length; j++) {
    const partial = aggregateBars(dailyBars.slice(trailing[0], trailing[j] + 1));
    const lineWithPartial = computeLine(completeBars.concat([partial]));
    out[trailing[j]] = lineWithPartial[lineWithPartial.length - 1];
  }

  return out;
}

/**
 * System builtin indicator table (TDX convention):
 * MACD family computed on the given bars' closes —
 * DIF = EMA(C,12)−EMA(C,26), DEA = EMA(DIF,9), histogram = 2×(DIF−DEA).
 */
export function createDefaultBuiltinIndicatorProvider(): BuiltinIndicatorProvider {
  return {
    getLine(indicator: string, line: string, bars: MarketData[]): number[] | undefined {
      if (indicator.toUpperCase() !== 'MACD') {
        return undefined;
      }
      const closes = bars.map((b) => b.close);
      switch (line.toUpperCase()) {
        case 'DIF':
          return MACD_DIF(closes, 12, 26);
        case 'DEA':
          return MACD_DEA(closes, 12, 26, 9);
        case 'MACD':
          return MACD_MACD(closes, 12, 26, 9);
        default:
          throw new Error(`内置指标 MACD 没有输出线 ${line}（可用 DIF/DEA/MACD）`);
      }
    },
  };
}
