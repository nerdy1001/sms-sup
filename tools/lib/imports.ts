import ts from "typescript";

export interface ImportRef {
  readonly specifier: string;
  readonly line: number;
  /** True for `import type ...` and `import("x").Type`: erased at runtime, still a dependency. */
  readonly typeOnly: boolean;
  readonly kind: "static" | "dynamic" | "require";
}

export interface ComputedImport {
  readonly line: number;
  readonly kind: "dynamic" | "require";
}

export interface ImportScan {
  readonly imports: ImportRef[];
  /** `import(expression)` or `require(expression)` where the target is not a plain string. */
  readonly computed: ComputedImport[];
}

export function parseSource(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

export function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function isPlainString(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

export function scanImports(sourceFile: ts.SourceFile): ImportScan {
  const imports: ImportRef[] = [];
  const computed: ComputedImport[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({
        specifier: node.moduleSpecifier.text,
        line: lineOf(sourceFile, node),
        typeOnly: node.importClause?.isTypeOnly === true,
        kind: "static",
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push({
        specifier: node.moduleSpecifier.text,
        line: lineOf(sourceFile, node),
        typeOnly: node.isTypeOnly,
        kind: "static",
      });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      imports.push({
        specifier: node.moduleReference.expression.text,
        line: lineOf(sourceFile, node),
        typeOnly: node.isTypeOnly,
        kind: "require",
      });
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) {
        const kind = isDynamicImport ? "dynamic" : "require";
        const argument = node.arguments[0];
        if (argument !== undefined && isPlainString(argument)) {
          imports.push({
            specifier: argument.text,
            line: lineOf(sourceFile, node),
            typeOnly: false,
            kind,
          });
        } else {
          computed.push({ line: lineOf(sourceFile, node), kind });
        }
      }
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) {
        imports.push({
          specifier: argument.literal.text,
          line: lineOf(sourceFile, node),
          typeOnly: true,
          kind: "dynamic",
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { imports, computed };
}
