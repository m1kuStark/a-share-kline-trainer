import { Lexer } from './lexer/Lexer';
import { Parser } from './parser/Parser';
import { Interpreter } from './interpreter/Interpreter';
import { ExecutionContext } from './interpreter/Context';
import { IncrementalContext } from './interpreter/IncrementalContext';
import { FunctionRegistry } from './interpreter/FunctionRegistry';
import { Program, isOutputDeclaration } from './parser/ast/nodes';
import { MarketData } from './types/MarketData';
import { FormulaResult, OutputLine, LineStyle } from './types/FormulaResult';
import {
  AUXILIARY_REFERENCE_DEPTH_LIMIT,
  AuxiliaryFormulaRegistry,
  AuxiliaryReferenceState,
  CrossPeriodResolver,
  FormulaEvaluationOptions,
  createDefaultBuiltinIndicatorProvider,
  normalizeAuxiliaryFormulas,
} from './crossPeriod';

/**
 * FormulaEngine - Main entry point for formula compilation and execution
 * Integrates lexer, parser, and interpreter to provide a simple API
 */
export class FormulaEngine {
  private registry: FunctionRegistry;

  /**
   * Create a new FormulaEngine instance
   * @param registry Optional custom function registry
   */
  constructor(registry?: FunctionRegistry) {
    this.registry = registry || new FunctionRegistry();
  }

  /**
   * Parse a formula string into an AST
   * @param formula Formula source code
   * @returns Parsed AST program
   * @throws {LexerError} If lexical analysis fails
   * @throws {ParserError} If parsing fails
   */
  parse(formula: string): Program {
    const lexer = new Lexer(formula);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    return parser.parse();
  }

  /**
   * Evaluate a formula with market data
   * @param formula Formula source code
   * @param marketData Array of market data records
   * @param options M9-02: cross-period / cross-formula evaluation options —
   *   `auxiliaryFormulas` registers sources referenced via "NAME.LINE#PERIOD";
   *   `builtinIndicators` overrides the default TDX MACD provider. Omitting
   *   options keeps builtin indicator references working (system definitions);
   *   auxiliary references then raise a human-readable error.
   * @returns Formula result containing outputs and variables
   * @throws {LexerError} If lexical analysis fails
   * @throws {ParserError} If parsing fails
   * @throws {RuntimeError} If execution fails
   */
  evaluate(formula: string, marketData: MarketData[], options?: FormulaEvaluationOptions): FormulaResult {
    return this.evaluateWithReferenceState(formula, marketData, options, { stack: [] });
  }

  /**
   * M9-02 patch: shared evaluate path carrying the auxiliary-reference stack
   * (cycle detection + depth limit live in one state per top-level call).
   */
  private evaluateWithReferenceState(
    formula: string,
    marketData: MarketData[],
    options: FormulaEvaluationOptions | undefined,
    referenceState: AuxiliaryReferenceState,
  ): FormulaResult {
    // Parse the formula
    const ast = this.parse(formula);

    // Create execution context
    const context = new ExecutionContext(marketData, this.registry);

    // M9-02 patch: wire the cross-period resolver (registry + builtin table)
    context.setCrossPeriodResolver(
      this.createCrossPeriodResolver(options, referenceState),
    );

    // Create interpreter and execute
    const interpreter = new Interpreter(context);
    interpreter.visitProgram(ast);

    // Collect results
    const outputs: OutputLine[] = [];
    const outputsMap = context.getOutputs();

    for (const [name, data] of outputsMap) {
      const statement = ast.body.find(
        (item) => isOutputDeclaration(item) && item.name === name,
      ) as { style?: LineStyle } | undefined;
      outputs.push({
        name,
        data,
        style: statement?.style,
      });
    }

    // Convert variables Map to Record
    const variables: Record<string, number[]> = {};
    const variablesMap = context.getVariables();
    for (const [name, value] of variablesMap) {
      variables[name] = value;
    }

    return {
      outputs,
      variables,
      drawings: context.getDrawings(),
    };
  }

  /**
   * Evaluate a formula incrementally with new market data
   * Only calculates values for new data points, reusing previous results
   *
   * @param formula Formula source code (must be the same as previous evaluation)
   * @param newData Complete array of market data (old + new data)
   * @param previousResult Previous formula result to build upon
   * @returns Formula result containing outputs and variables
   * @throws {LexerError} If lexical analysis fails
   * @throws {ParserError} If parsing fails
   * @throws {RuntimeError} If execution fails
   *
   * @example
   * ```typescript
   * // Initial evaluation with 100 data points
   * const result1 = engine.evaluate(formula, marketData.slice(0, 100));
   *
   * // Add 10 new data points and evaluate incrementally
   * const result2 = engine.evaluateIncremental(
   *   formula,
   *   marketData.slice(0, 110),
   *   result1
   * );
   * // Only calculates for the 10 new points, much faster!
   * ```
   */
  evaluateIncremental(
    formula: string,
    newData: MarketData[],
    previousResult: FormulaResult,
  ): FormulaResult {
    // Validate inputs
    if (!previousResult || !previousResult.outputs || previousResult.outputs.length === 0) {
      throw new Error('Previous result is required for incremental evaluation');
    }

    const previousLength = previousResult.outputs[0].data.length;

    if (newData.length < previousLength) {
      throw new Error(
        `New data (${newData.length} points) must have at least as many points as previous data (${previousLength} points)`,
      );
    }

    // If no new data, return previous result
    if (newData.length === previousLength) {
      return previousResult;
    }

    // Parse the formula
    const ast = this.parse(formula);

    // Create incremental execution context
    const context = new IncrementalContext(newData, this.registry, previousLength);

    // Restore previous variables and outputs into context
    for (const [name, value] of Object.entries(previousResult.variables)) {
      context.restoreVariable(name, value);
    }

    for (const output of previousResult.outputs) {
      context.restoreOutput(output.name, output.data);
    }

    // Create interpreter and execute
    // The interpreter will use the context to only calculate new values
    const interpreter = new Interpreter(context);
    interpreter.visitProgram(ast);

    // Collect results (will include both old and new data)
    const outputs: OutputLine[] = [];
    const outputsMap = context.getOutputs();

    for (const [name, data] of outputsMap) {
      const statement = ast.body.find(
        (item) => isOutputDeclaration(item) && item.name === name,
      ) as { style?: LineStyle } | undefined;
      outputs.push({
        name,
        data,
        style: statement?.style,
      });
    }

    // Convert variables Map to Record
    const variables: Record<string, number[]> = {};
    const variablesMap = context.getVariables();
    for (const [name, value] of variablesMap) {
      variables[name] = value;
    }

    return {
      outputs,
      variables,
      drawings: context.getDrawings(),
    };
  }

  /**
   * Get the function registry
   * @returns Function registry instance
   */
  getRegistry(): FunctionRegistry {
    return this.registry;
  }

  /**
   * M9-02 patch: build the cross-period resolver for one evaluation.
   * Auxiliary sub-evaluations recurse through evaluateWithReferenceState with
   * the SAME reference state, so cycles and depth are caught across levels.
   * Unregistered names and missing output lines raise human-readable errors.
   */
  private createCrossPeriodResolver(
    options: FormulaEvaluationOptions | undefined,
    referenceState: AuxiliaryReferenceState,
  ): CrossPeriodResolver {
    if (!options) {
      return {};
    }
    const auxiliary: AuxiliaryFormulaRegistry | undefined = normalizeAuxiliaryFormulas(options.auxiliaryFormulas);
    const resolver: CrossPeriodResolver = {
      builtinIndicators: options.builtinIndicators ?? createDefaultBuiltinIndicatorProvider(),
    };
    if (auxiliary) {
      resolver.evaluateAuxiliary = (name: string, bars: MarketData[]): Map<string, number[]> => {
        const source = auxiliary.get(name);
        if (source === undefined) {
          throw new Error(
            `跨公式引用失败：辅助公式 ${name} 未注册（请在 evaluate 的 options.auxiliaryFormulas 中提供其源码）`,
          );
        }
        if (referenceState.stack.includes(name)) {
          throw new Error(
            `跨公式引用检测到环：${[...referenceState.stack, name].join(' -> ')}（请检查辅助公式之间的相互引用）`,
          );
        }
        if (referenceState.stack.length >= AUXILIARY_REFERENCE_DEPTH_LIMIT) {
          throw new Error(
            `跨公式引用深度超过上限 ${AUXILIARY_REFERENCE_DEPTH_LIMIT} 层：${[...referenceState.stack, name].join(' -> ')}`,
          );
        }
        referenceState.stack.push(name);
        try {
          const subResult = this.evaluateWithReferenceState(source, bars, options, referenceState);
          return new Map(subResult.outputs.map((output) => [output.name, output.data]));
        } finally {
          referenceState.stack.pop();
        }
      };
    }
    return resolver;
  }
}
