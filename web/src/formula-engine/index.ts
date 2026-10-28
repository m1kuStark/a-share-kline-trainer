/**
 * Formula-TS: A TypeScript implementation of a formula parser and interpreter
 * @packageDocumentation
 */

export const VERSION = '1.0.0';

// Export main engine
export { FormulaEngine } from './FormulaEngine';

// Export error classes
export {
  FormulaError,
  LexerError,
  ParserError,
  RuntimeError,
} from './errors';

// Export types
export { MarketData, validateMarketData, getMarketDataLength } from './types/MarketData';
export { FormulaResult, OutputLine, LineStyle, DrawingEvent } from './types/FormulaResult';

// Export AST node types
export {
  NodeType,
  BinaryOperator,
  UnaryOperator,
  DrawingStyle,
  Program,
  Statement,
  Expression,
  VariableDeclaration,
  OutputDeclaration,
  BinaryExpression,
  UnaryExpression,
  FunctionCall,
  Identifier,
  NumberLiteral,
  StringLiteral,
  PeriodReference,
} from './parser/ast/nodes';

// Export core components (for advanced usage)
export { Lexer } from './lexer/Lexer';
export { Token } from './lexer/Token';
export { TokenType } from './lexer/TokenType';
export { Parser } from './parser/Parser';
export { Interpreter } from './interpreter/Interpreter';
export { ExecutionContext } from './interpreter/Context';
export { FunctionRegistry, FormulaFunction } from './interpreter/FunctionRegistry';

// Export built-in functions
export * from './interpreter/functions';

// M9-01 patch layer: future-function static marking (support + explicit marking, never forbid)
export { scanFutureFunctions, FUTURE_FUNCTIONS } from './futureFunctions';

// M9-02 patch layer: cross-period / cross-formula references (#WEEK / #MONTH, auxiliary registry)
export {
  PeriodSuffix,
  ResamplePeriod,
  PERIOD_SUFFIXES,
  AUXILIARY_REFERENCE_DEPTH_LIMIT,
  FormulaEvaluationOptions,
  BuiltinIndicatorProvider,
  AuxiliaryFormulaRegistry,
  AuxiliaryReferenceState,
  CrossPeriodResolver,
  isKnownPeriodSuffix,
  normalizeAuxiliaryFormulas,
  aggregateBars,
  resampleBars,
  broadcastReferenceLine,
  createDefaultBuiltinIndicatorProvider,
} from './crossPeriod';

// M9-03 patch layer: market-context functions (FINANCE(3)/NAMELIKE/CODELIKE/HYBLOCK/HY_INDEX family)
export {
  StockContext,
  StockIndustryContext,
  BOARD_TYPE,
  MARKET_CONTEXT_BARE_FUNCTIONS,
  boardTypeOfCode,
  prefixMatchSeries,
  constantSeries,
  localDateKey,
  alignIndexField,
  marketBlockName,
  requireIndexBars,
  evaluateBareMarketContext,
} from './marketContext';
