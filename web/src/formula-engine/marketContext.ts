/**
 * Market-context functions core (M9-03 patch layer).
 *
 * Frozen semantics (task card M9-03, 2026-10-28):
 * - `FINANCE(3)` = instrument board type derived from the security code prefix
 *   (constant series): 60/00 → 1 沪深主板 (frozen workspace convention);
 *   688/689 → 科创板; 300/301 → 创业板; 4/8/92 prefixes → 北交所. The non-main
 *   board values are proposed defaults (speed-reference table has no FINANCE(3)
 *   entry; distinct values enable `<>1` exclusion). Any other FINANCE argument
 *   number raises a human-readable "not implemented" error — no fake values.
 * - `NAMELIKE(s)` / `CODELIKE(s)` = name / code prefix match (boolean constant
 *   series, TDX convention).
 * - `HYBLOCK` = industry name (string constant); missing industry data raises
 *   a human-readable error. `DYBLOCK` / `GNBLOCK` / `FGBLOCK` follow the same
 *   shape for region / concept / style names (corpus 六龙连山-3 support).
 * - `HY_INDEXC/O/H/L/V/A` = industry-index close/open/high/low/volume/amount
 *   series aligned onto the stock daily axis BY CALENDAR DATE: a stock bar
 *   whose date is missing from the index bars yields NaN (comparisons are
 *   false, no crash — same NaN semantics as the cross-period warmup). Index
 *   dates not present on the stock axis are ignored. Misalignment is a defect.
 *
 * Pure functions only: the Interpreter dispatches into these; FormulaEngine
 * injects the StockContext via evaluate options (M9-02 provider precedent).
 */
import { MarketData } from './types/MarketData';

/** Industry attribution of the evaluated stock. */
export interface StockIndustryContext {
  /** 行业名（HYBLOCK 返回值） */
  name: string;
  /** 通达信行业根 blockCode（如 T0305）；显式映射文件路径下可缺省 */
  blockCode?: string;
  /** 行业指数代码（如 sh880380，指向 vipdoc/sh/lday/sh880380.day） */
  indexCode?: string;
}

/**
 * Injected market context of the evaluated security. Calling a market-context
 * function without an injected context raises a human-readable error.
 */
export interface StockContext {
  /** 6 位证券代码（如 600519）——FINANCE(3)/CODELIKE 的派生源 */
  code: string;
  /** 证券名称（如 贵州茅台）——NAMELIKE 的匹配主体 */
  name: string;
  /** 所属行业（null＝无行业数据；HYBLOCK 报人话错误） */
  industry: StockIndustryContext | null;
  /** 行业指数日线（HY_INDEXC/O/H/L/V/A 的数据源，按日期对齐到股票日线轴） */
  industryIndexBars?: MarketData[];
  /** 地域名（DYBLOCK） */
  regionName?: string;
  /** 概念名（GNBLOCK） */
  conceptName?: string;
  /** 风格名（FGBLOCK） */
  styleName?: string;
}

/**
 * FINANCE(3) board-type constants.
 * MAIN=1 is the frozen workspace convention (AGENTS.md 公式域口径);
 * CHINEXT/STAR/BSE values are proposed defaults (见文件头注).
 */
export const BOARD_TYPE = {
  /** 沪深主板（60/00 前缀）——工作区冻结口径 */
  MAIN: 1,
  /** 创业板（300/301 前缀）——proposed_default */
  CHINEXT: 2,
  /** 科创板（688/689 前缀）——proposed_default */
  STAR: 3,
  /** 北交所（4/8/92 前缀）——proposed_default */
  BSE: 4,
} as const;

/**
 * Derive the FINANCE(3) board type from a 6-digit security code.
 * Unknown prefixes raise (never fabricate a value).
 */
export function boardTypeOfCode(code: string): number {
  if (/^(688|689)/.test(code)) return BOARD_TYPE.STAR;
  if (/^(300|301)/.test(code)) return BOARD_TYPE.CHINEXT;
  if (/^(60|00)/.test(code)) return BOARD_TYPE.MAIN;
  if (/^(4|8|92)/.test(code)) return BOARD_TYPE.BSE;
  throw new Error(
    `无法识别的证券代码前缀：${code}（FINANCE(3) 品种类型仅支持沪深主板 60/00、创业板 300/301、科创板 688/689、北交所 4/8/92 前缀）`,
  );
}

/** Boolean constant series of a prefix test (`subject.startsWith(prefix)`). */
export function prefixMatchSeries(length: number, subject: string, prefix: string): number[] {
  return new Array<number>(length).fill(subject.startsWith(prefix) ? 1 : 0);
}

/** Numeric constant series. */
export function constantSeries(length: number, value: number): number[] {
  return new Array<number>(length).fill(value);
}

/**
 * Local-calendar date key of a bar timestamp (same convention as the
 * cross-period week/month grouping: calendar date via local getters).
 * Bars are expected to carry timestamps whose local calendar date equals the
 * trading date (the server emits local-midnight timestamps).
 */
export function localDateKey(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

type IndexField = 'open' | 'high' | 'low' | 'close' | 'volume' | 'amount';

/**
 * Align an industry-index field onto the stock daily axis by calendar date.
 * Missing index dates → NaN; index dates absent from the stock axis → ignored.
 */
export function alignIndexField(stockBars: MarketData[], indexBars: MarketData[], field: IndexField): number[] {
  const byDate = new Map<string, number>();
  for (const bar of indexBars) {
    byDate.set(localDateKey(bar.timestamp), field === 'amount' ? (bar.amount ?? NaN) : (bar[field] as number));
  }
  return stockBars.map((bar) => {
    const value = byDate.get(localDateKey(bar.timestamp));
    return value === undefined ? NaN : value;
  });
}

/** Market-context function names usable without parentheses (identifier form). */
export const MARKET_CONTEXT_BARE_FUNCTIONS: readonly string[] = [
  'HYBLOCK',
  'DYBLOCK',
  'GNBLOCK',
  'FGBLOCK',
  'HY_INDEXC',
  'HY_INDEXO',
  'HY_INDEXH',
  'HY_INDEXL',
  'HY_INDEXV',
  'HY_INDEXA',
];

/** Resolve a bare market-context function name to its value, or undefined when unknown. */
export function evaluateBareMarketContext(
  name: string,
  context: StockContext,
  stockBars: MarketData[],
): string | number[] | undefined {
  switch (name) {
    case 'HYBLOCK':
    case 'DYBLOCK':
    case 'GNBLOCK':
    case 'FGBLOCK':
      return marketBlockName(name, context);
    case 'HY_INDEXC':
      return alignIndexField(stockBars, requireIndexBars(name, context), 'close');
    case 'HY_INDEXO':
      return alignIndexField(stockBars, requireIndexBars(name, context), 'open');
    case 'HY_INDEXH':
      return alignIndexField(stockBars, requireIndexBars(name, context), 'high');
    case 'HY_INDEXL':
      return alignIndexField(stockBars, requireIndexBars(name, context), 'low');
    case 'HY_INDEXV':
      return alignIndexField(stockBars, requireIndexBars(name, context), 'volume');
    case 'HY_INDEXA':
      return alignIndexField(stockBars, requireIndexBars(name, context), 'amount');
    default:
      return undefined;
  }
}

/** Block-name lookup with human-readable errors on missing context data (no fake values). */
export function marketBlockName(fnName: string, context: StockContext): string {
  switch (fnName) {
    case 'HYBLOCK': {
      const industry = context.industry;
      if (!industry || !industry.name) {
        throw new Error(`HYBLOCK 需要 StockContext.industry 提供所属行业名（当前上下文无行业数据）`);
      }
      return industry.name;
    }
    case 'DYBLOCK':
      if (!context.regionName) {
        throw new Error(`DYBLOCK 需要 StockContext.regionName 提供地域名（当前上下文未提供地域数据）`);
      }
      return context.regionName;
    case 'GNBLOCK':
      if (!context.conceptName) {
        throw new Error(`GNBLOCK 需要 StockContext.conceptName 提供概念名（当前上下文未提供概念数据）`);
      }
      return context.conceptName;
    case 'FGBLOCK':
      if (!context.styleName) {
        throw new Error(`FGBLOCK 需要 StockContext.styleName 提供风格名（当前上下文未提供风格数据）`);
      }
      return context.styleName;
    default:
      throw new Error(`未知板块名函数：${fnName}`);
  }
}

/** Industry index bars with a human-readable error when the context lacks them. */
export function requireIndexBars(fnName: string, context: StockContext): MarketData[] {
  if (!context.industryIndexBars) {
    throw new Error(
      `${fnName} 需要 StockContext.industryIndexBars 提供行业指数日线（当前上下文未注入行业指数序列）`,
    );
  }
  return context.industryIndexBars;
}
