/**
 * AST Node Types and Interfaces
 * Defines the structure of the Abstract Syntax Tree for the formula language
 * @packageDocumentation
 */

/**
 * Enumeration of all possible AST node types
 */
export enum NodeType {
  // Program and Statements
  Program = 'Program',
  VariableDeclaration = 'VariableDeclaration',
  OutputDeclaration = 'OutputDeclaration',
  ExpressionStatement = 'ExpressionStatement',

  // Expressions
  BinaryExpression = 'BinaryExpression',
  UnaryExpression = 'UnaryExpression',
  FunctionCall = 'FunctionCall',
  ConditionalExpression = 'ConditionalExpression',

  // M9-02 patch: cross-period / cross-formula reference ("MACD.DEA#WEEK", MACD.DIF#MONTH)
  PeriodReference = 'PeriodReference',

  // Literals and Identifiers
  Identifier = 'Identifier',
  NumberLiteral = 'NumberLiteral',
  StringLiteral = 'StringLiteral',
}

/**
 * Binary operators supported by the language
 */
export enum BinaryOperator {
  // Arithmetic
  Plus = '+',
  Minus = '-',
  Multiply = '*',
  Divide = '/',
  Modulo = '%',
  Power = '^',

  // Comparison
  Equal = '==',
  NotEqual = '!=',
  LessThan = '<',
  LessThanOrEqual = '<=',
  GreaterThan = '>',
  GreaterThanOrEqual = '>=',

  // Logical
  And = '&&',
  Or = '||',
}

/**
 * Unary operators supported by the language
 */
export enum UnaryOperator {
  Minus = '-',
  Not = '!',
}

/**
 * Drawing style configuration for output declarations
 */
export interface DrawingStyle {
  color?: string;
  size?: number;
  lineStyle?: string;
  drawMethod?: string;
  hidden?: boolean;
  bold?: boolean;
  italic?: boolean;
}

/**
 * Base interface for all AST nodes
 * Uses discriminated union pattern with NodeType enum
 */
export interface ASTNode {
  type: NodeType;
}

/**
 * Expression interface - all expressions are also statements
 */
export interface Expression extends ASTNode {}

/**
 * Statement interface
 */
export interface Statement extends ASTNode {}

/**
 * Program node - root of the AST
 */
export interface Program extends ASTNode {
  type: NodeType.Program;
  body: Statement[];
}

/**
 * Variable declaration: var x = 10;
 */
export interface VariableDeclaration extends Statement {
  type: NodeType.VariableDeclaration;
  name: string;
  value: Expression;
  /** M9-01 patch: statement-level drawing style (e.g. X := expr, COLORRED;) */
  style?: DrawingStyle;
}

/**
 * Output declaration: output result = x + y; or output result = x + y; [color: red, size: 14];
 */
export interface OutputDeclaration extends Statement {
  type: NodeType.OutputDeclaration;
  name: string;
  value: Expression;
  style?: DrawingStyle;
}

/**
 * Expression statement: expression;
 */
export interface ExpressionStatement extends Statement {
  type: NodeType.ExpressionStatement;
  expression: Expression;
  /** M9-01 patch: statement-level drawing style (e.g. expr, COLORRED; or STICKLINE(...), COLORRED;) */
  style?: DrawingStyle;
}

/**
 * Binary expression: left operator right
 * Supports arithmetic, comparison, and logical operators
 */
export interface BinaryExpression extends Expression {
  type: NodeType.BinaryExpression;
  left: Expression;
  operator: BinaryOperator;
  right: Expression;
}

/**
 * Unary expression: operator operand
 * Supports unary minus and logical not
 */
export interface UnaryExpression extends Expression {
  type: NodeType.UnaryExpression;
  operator: UnaryOperator;
  operand: Expression;
}

/**
 * Function call: functionName(arg1, arg2, ...)
 */
export interface FunctionCall extends Expression {
  type: NodeType.FunctionCall;
  name: string;
  arguments: Expression[];
}

/**
 * Conditional (ternary) expression: test ? consequent : alternate
 */
export interface ConditionalExpression extends Expression {
  type: NodeType.ConditionalExpression;
  test: Expression;
  consequent: Expression;
  alternate: Expression;
}

/**
 * Identifier: variable or function name reference
 */
export interface Identifier extends Expression {
  type: NodeType.Identifier;
  name: string;
}

/**
 * Number literal: numeric constant
 */
export interface NumberLiteral extends Expression {
  type: NodeType.NumberLiteral;
  value: number;
}

/**
 * String literal: text payload for drawing functions
 */
export interface StringLiteral extends Expression {
  type: NodeType.StringLiteral;
  value: string;
}

/**
 * M9-02 patch: cross-period / cross-formula reference.
 * Both quoted ("MACD.DEA#WEEK") and bare (MACD.DIF#MONTH) forms parse into this
 * node; `period` is validated at parse time to DAY/WEEK/MONTH. `indicator` is a
 * builtin indicator name (MACD) or a registered auxiliary formula name; `line`
 * is the referenced output line of that indicator/formula.
 */
export interface PeriodReference extends Expression {
  type: NodeType.PeriodReference;
  indicator: string;
  line: string;
  period: 'DAY' | 'WEEK' | 'MONTH';
  quoted: boolean;
}

/**
 * Type guard functions for discriminated unions
 */

export function isProgram(node: ASTNode): node is Program {
  return node.type === NodeType.Program;
}

export function isVariableDeclaration(node: ASTNode): node is VariableDeclaration {
  return node.type === NodeType.VariableDeclaration;
}

export function isOutputDeclaration(node: ASTNode): node is OutputDeclaration {
  return node.type === NodeType.OutputDeclaration;
}

export function isExpressionStatement(node: ASTNode): node is ExpressionStatement {
  return node.type === NodeType.ExpressionStatement;
}

export function isBinaryExpression(node: ASTNode): node is BinaryExpression {
  return node.type === NodeType.BinaryExpression;
}

export function isUnaryExpression(node: ASTNode): node is UnaryExpression {
  return node.type === NodeType.UnaryExpression;
}

export function isFunctionCall(node: ASTNode): node is FunctionCall {
  return node.type === NodeType.FunctionCall;
}

export function isConditionalExpression(node: ASTNode): node is ConditionalExpression {
  return node.type === NodeType.ConditionalExpression;
}

export function isIdentifier(node: ASTNode): node is Identifier {
  return node.type === NodeType.Identifier;
}

export function isNumberLiteral(node: ASTNode): node is NumberLiteral {
  return node.type === NodeType.NumberLiteral;
}

export function isStringLiteral(node: ASTNode): node is StringLiteral {
  return node.type === NodeType.StringLiteral;
}

export function isPeriodReference(node: ASTNode): node is PeriodReference {
  return node.type === NodeType.PeriodReference;
}

/**
 * Utility type for all possible AST nodes (discriminated union)
 */
export type AnyASTNode =
  | Program
  | VariableDeclaration
  | OutputDeclaration
  | ExpressionStatement
  | BinaryExpression
  | UnaryExpression
  | FunctionCall
  | ConditionalExpression
  | Identifier
  | NumberLiteral
  | StringLiteral
  | PeriodReference;
