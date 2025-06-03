import { parse } from "npm:@typescript-eslint/typescript-estree@8.18.0";
import { AST_NODE_TYPES } from "npm:@typescript-eslint/typescript-estree@8.18.0";
import type {
  DecoratorInfo,
  ExportInfo,
  ImportInfo,
  JSDocTagInfo,
  ModuleAnalysis,
} from "./types.ts";

/**
 * TypeScript/JavaScript AST解析器
 *
 * ファイルを解析して以下を抽出:
 * - export関数・変数・クラス
 * - import文
 * - @decoratorタグ
 * - JSDocタグ（@activity, @event等）
 */
export class ASTAnalyzer {
  /**
   * ファイルを解析してモジュール情報を抽出
   */
  async analyze(filePath: string): Promise<ModuleAnalysis> {
    const code = await Deno.readTextFile(filePath);
    return this.analyzeCode(filePath, code);
  }

  /**
   * コードを解析してモジュール情報を抽出
   */
  analyzeCode(filePath: string, code: string): ModuleAnalysis {
    try {
      const ast = parse(code, {
        loc: true,
        range: true,
        comment: true,
        tokens: true,
        ecmaFeatures: {
          jsx: true,
        },
        ecmaVersion: 2022,
        sourceType: "module",
      });

      const exports: ExportInfo[] = [];
      const imports: ImportInfo[] = [];
      const decorators: DecoratorInfo[] = [];
      const jsDocTags: JSDocTagInfo[] = [];

      // ASTを走査
      this.traverseNode(ast, {
        exports,
        imports,
        decorators,
        jsDocTags,
        comments: ast.comments || [],
      });

      return {
        filePath,
        exports,
        imports,
        decorators,
        jsDocTags,
      };
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      console.warn(`AST解析エラー (${filePath}):`, errorMessage);
      return {
        filePath,
        exports: [],
        imports: [],
        decorators: [],
        jsDocTags: [],
      };
    }
  }

  /**
   * ASTノードを再帰的に走査
   */
  private traverseNode(node: any, context: {
    exports: ExportInfo[];
    imports: ImportInfo[];
    decorators: DecoratorInfo[];
    jsDocTags: JSDocTagInfo[];
    comments: any[];
  }): void {
    if (!node || typeof node !== "object") return;

    // Export宣言の処理
    if (node.type === AST_NODE_TYPES.ExportNamedDeclaration) {
      this.handleExportDeclaration(node, context);
    }

    // Import宣言の処理
    if (node.type === AST_NODE_TYPES.ImportDeclaration) {
      this.handleImportDeclaration(node, context);
    }

    // デコレータの処理
    if (node.decorators?.length > 0) {
      this.handleDecorators(node, context);
    }

    // JSDocコメントの処理
    this.handleJSDocComments(node, context);

    // 子ノードを再帰処理
    for (const key in node) {
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach((item) => this.traverseNode(item, context));
      } else if (child && typeof child === "object") {
        this.traverseNode(child, context);
      }
    }
  }

  /**
   * Export宣言の処理
   */
  private handleExportDeclaration(
    node: any,
    context: { exports: ExportInfo[] },
  ): void {
    if (node.declaration) {
      const decl = node.declaration;

      if (decl.type === AST_NODE_TYPES.FunctionDeclaration && decl.id) {
        context.exports.push({
          name: decl.id.name,
          type: "function",
          isDefault: false,
          line: decl.loc?.start.line || 0,
          column: decl.loc?.start.column || 0,
        });
      } else if (decl.type === AST_NODE_TYPES.VariableDeclaration) {
        decl.declarations.forEach((declarator: any) => {
          if (declarator.id?.name) {
            context.exports.push({
              name: declarator.id.name,
              type: "const",
              isDefault: false,
              line: declarator.loc?.start.line || 0,
              column: declarator.loc?.start.column || 0,
            });
          }
        });
      } else if (decl.type === AST_NODE_TYPES.ClassDeclaration && decl.id) {
        context.exports.push({
          name: decl.id.name,
          type: "class",
          isDefault: false,
          line: decl.loc?.start.line || 0,
          column: decl.loc?.start.column || 0,
        });
      }
    }

    // 個別エクスポート (export { foo, bar })
    if (node.specifiers?.length > 0) {
      node.specifiers.forEach((spec: any) => {
        if (spec.type === AST_NODE_TYPES.ExportSpecifier) {
          context.exports.push({
            name: spec.exported.name,
            type: "const", // 型推論は困難なのでconstとする
            isDefault: false,
            line: spec.loc?.start.line || 0,
            column: spec.loc?.start.column || 0,
          });
        }
      });
    }
  }

  /**
   * Import宣言の処理
   */
  private handleImportDeclaration(
    node: any,
    context: { imports: ImportInfo[] },
  ): void {
    const imports: { name: string; alias?: string }[] = [];

    node.specifiers?.forEach((spec: any) => {
      if (spec.type === AST_NODE_TYPES.ImportSpecifier) {
        imports.push({
          name: spec.imported.name,
          alias: spec.local.name !== spec.imported.name
            ? spec.local.name
            : undefined,
        });
      } else if (spec.type === AST_NODE_TYPES.ImportDefaultSpecifier) {
        imports.push({
          name: "default",
          alias: spec.local.name,
        });
      } else if (spec.type === AST_NODE_TYPES.ImportNamespaceSpecifier) {
        imports.push({
          name: "*",
          alias: spec.local.name,
        });
      }
    });

    context.imports.push({
      source: node.source.value,
      imports,
      isTypeOnly: node.importKind === "type",
      line: node.loc?.start.line || 0,
    });
  }

  /**
   * デコレータの処理
   */
  private handleDecorators(
    node: any,
    context: { decorators: DecoratorInfo[] },
  ): void {
    const targetFunction = this.getFunctionName(node);
    if (!targetFunction) return;

    node.decorators.forEach((decorator: any) => {
      const decoratorName = this.getDecoratorName(decorator);
      const args = this.getDecoratorArgs(decorator);

      if (decoratorName) {
        context.decorators.push({
          name: decoratorName,
          args,
          targetFunction,
          line: decorator.loc?.start.line || 0,
        });
      }
    });
  }

  /**
   * JSDocコメントの処理
   */
  private handleJSDocComments(node: any, context: {
    jsDocTags: JSDocTagInfo[];
    comments: any[];
  }): void {
    const targetFunction = this.getFunctionName(node);
    if (!targetFunction) return;

    // 関数の直前のコメントを探す
    const functionLine = node.loc?.start.line || 0;
    const relevantComments = context.comments.filter((comment) =>
      comment.loc.end.line === functionLine - 1 ||
      comment.loc.end.line === functionLine - 2
    );

    relevantComments.forEach((comment) => {
      if (comment.type === "Block" && comment.value.includes("@")) {
        this.parseJSDocTags(
          comment.value,
          targetFunction,
          comment.loc.start.line,
          context,
        );
      }
    });
  }

  /**
   * JSDocタグをパース
   */
  private parseJSDocTags(
    commentValue: string,
    targetFunction: string,
    startLineOfCommentBlock: number,
    context: { jsDocTags: JSDocTagInfo[] },
  ): void {
    const lines = commentValue.split("\n");

    lines.forEach((lineContent, index) => {
      const trimmed = lineContent.trim().replace(/^\*\s?/, "");
      const tagMatch = trimmed.match(/^@(\w+)(?:\s+(.+))?/);

      if (tagMatch) {
        const [, tag, value] = tagMatch;
        context.jsDocTags.push({
          tag,
          value: value || "",
          targetFunction,
          line: startLineOfCommentBlock + index,
        });
      }
    });
  }

  /**
   * 関数名を取得
   */
  private getFunctionName(node: any): string | null {
    if (node.type === AST_NODE_TYPES.FunctionDeclaration && node.id) {
      return node.id.name;
    }
    if (node.type === AST_NODE_TYPES.VariableDeclarator && node.id?.name) {
      return node.id.name;
    }
    if (node.type === AST_NODE_TYPES.MethodDefinition && node.key?.name) {
      return node.key.name;
    }
    return null;
  }

  /**
   * デコレータ名を取得
   */
  private getDecoratorName(decorator: any): string | null {
    if (decorator.expression?.type === AST_NODE_TYPES.Identifier) {
      return decorator.expression.name;
    }
    if (decorator.expression?.type === AST_NODE_TYPES.CallExpression) {
      if (decorator.expression.callee?.name) {
        return decorator.expression.callee.name;
      }
    }
    return null;
  }

  /**
   * デコレータ引数を取得
   */
  private getDecoratorArgs(decorator: any): unknown[] {
    if (decorator.expression?.type === AST_NODE_TYPES.CallExpression) {
      return decorator.expression.arguments?.map((arg: any) => {
        if (arg.type === AST_NODE_TYPES.Literal) {
          return arg.value;
        }
        if (arg.type === AST_NODE_TYPES.ObjectExpression) {
          // 簡単なオブジェクト解析
          const obj: Record<string, unknown> = {};
          arg.properties?.forEach((prop: any) => {
            if (prop.key?.name && prop.value?.value !== undefined) {
              obj[prop.key.name] = prop.value.value;
            }
          });
          return obj;
        }
        return null;
      }) || [];
    }
    return [];
  }
}
