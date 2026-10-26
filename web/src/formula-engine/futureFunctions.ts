/**
 * Future-function static marking (M9-01 patch layer).
 *
 * Policy (user decision 2026-10-26): future functions are supported and
 * explicitly marked, never forbidden. Marking is a pure static scan over the
 * parsed AST and does not change execution results.
 */
import { Lexer } from './lexer/Lexer';
import { Parser } from './parser/Parser';
import {
  ASTNode,
  FunctionCall,
  NodeType,
  Program,
} from './parser/ast/nodes';

/**
 * Metadata table of future-function families (extendable).
 * Starter list per M9-01: BACKSET / REFX / REFXV / ZIG family, plus the
 * matrix-named FILTER and the other TDX future-function names that share the
 * same look-ahead behavior. Membership is a marking decision, not a gate.
 */
export const FUTURE_FUNCTIONS: readonly string[] = [
  'BACKSET',
  'FILTER',
  'REFX',
  'REFXV',
  'ZIG',
  'ZIGA',
  'ZIG3',
  'PEAK',
  'PEAKBARS',
  'TROUGH',
  'TROUGHBARS',
  'FINDHIGH',
  'FINDLOW',
];

function collectFunctionNames(node: ASTNode, into: Set<string>): void {
  // Structural child access keeps the walker resilient across statement/expression kinds
  const composite = node as unknown as Record<string, ASTNode | undefined>;

  switch (node.type) {
    case NodeType.Program:
      for (const statement of (node as Program).body) {
        collectFunctionNames(statement, into);
      }
      break;
    case NodeType.VariableDeclaration:
    case NodeType.OutputDeclaration: {
      const value = composite.value;
      if (value) {
        collectFunctionNames(value, into);
      }
      break;
    }
    case NodeType.ExpressionStatement: {
      const expression = composite.expression;
      if (expression) {
        collectFunctionNames(expression, into);
      }
      break;
    }
    case NodeType.BinaryExpression:
    case NodeType.UnaryExpression:
    case NodeType.ConditionalExpression:
      for (const key of ['left', 'right', 'operand', 'test', 'consequent', 'alternate']) {
        const child = composite[key];
        if (child) {
          collectFunctionNames(child, into);
        }
      }
      break;
    case NodeType.FunctionCall: {
      const call = node as FunctionCall;
      into.add(call.name.toUpperCase());
      for (const argument of call.arguments) {
        collectFunctionNames(argument, into);
      }
      break;
    }
    default:
      break;
  }
}

/**
 * Statically scan a formula source for future-function usage.
 *
 * @param formula Formula source code
 * @returns Sorted, de-duplicated list of future-function names actually used
 * @throws {LexerError} If lexical analysis fails
 * @throws {ParserError} If parsing fails
 */
export function scanFutureFunctions(formula: string): string[] {
  const tokens = new Lexer(formula).tokenize();
  const program = new Parser(tokens).parse();

  const used = new Set<string>();
  for (const statement of program.body) {
    collectFunctionNames(statement, used);
  }

  const table = new Set(FUTURE_FUNCTIONS);
  return [...used].filter((name) => table.has(name)).sort();
}
