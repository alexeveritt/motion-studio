import { readdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { toRepoRelative } from "./repo.ts";
import type { ProductionRecord } from "./schemas/production.ts";
import type { WorkspaceService } from "./workspace.ts";

export type SourceDiagnostic = {
  /** Repository-relative file, when the diagnostic has one. */
  file?: string;
  line?: number;
  column?: number;
  message: string;
  code: number;
};

export type CompileCheck = {
  ok: boolean;
  /** Repository-relative files that were checked. */
  files: string[];
  diagnostics: SourceDiagnostic[];
};

/** Mirrors tsconfig.base.json, minus Node types: compositions run in a browser. */
const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023,
  lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  moduleDetection: ts.ModuleDetectionKind.Force,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  noUncheckedIndexedAccess: true,
  noEmit: true,
  isolatedModules: true,
  allowImportingTsExtensions: true,
  resolveJsonModule: true,
  skipLibCheck: true,
  types: [],
};

const SOURCE = /\.(ts|tsx)$/;
const MAX_FILES = 500;

/**
 * Type-check a production's `src/` folder: syntax errors, missing imports,
 * type errors and a wrong composition contract all surface here with file,
 * line and column. Diagnostics from outside the production are dropped.
 */
export async function checkProductionSource(
  workspace: WorkspaceService,
  productionId: string,
): Promise<CompileCheck> {
  const { dir, record } = await workspace.locate("production", productionId);
  const production = record as ProductionRecord;
  const srcDir = workspace.policy.resolve(dir, "src");
  const entry = workspace.policy.resolveRelative(dir, production.files.entry);
  const rootNames = await sourceFiles(srcDir);
  const relative = (file: string) => toRepoRelative(workspace.repoRoot, file);

  if (!rootNames.includes(entry)) {
    return {
      ok: false,
      files: rootNames.map(relative),
      diagnostics: [{ message: `${production.files.entry} does not exist`, code: 0 }],
    };
  }

  const program = ts.createProgram({ rootNames, options: COMPILER_OPTIONS });
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => !diagnostic.file || isWithin(dir, diagnostic.file.fileName))
    .map((diagnostic): SourceDiagnostic => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      if (!diagnostic.file || diagnostic.start === undefined)
        return { message, code: diagnostic.code };
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return {
        file: relative(diagnostic.file.fileName),
        line: line + 1,
        column: character + 1,
        message,
        code: diagnostic.code,
      };
    });

  return { ok: diagnostics.length === 0, files: rootNames.map(relative), diagnostics };
}

export function formatDiagnostic(diagnostic: SourceDiagnostic): string {
  const location = diagnostic.file
    ? `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} `
    : "";
  return `${location}${diagnostic.code ? `TS${diagnostic.code}: ` : ""}${diagnostic.message}`;
}

async function sourceFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const walk = async (current: string, depth: number) => {
    if (depth > 8 || results.length >= MAX_FILES) return;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink() || entry.name === "node_modules")
        continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile() && SOURCE.test(entry.name) && !entry.name.endsWith(".d.ts"))
        results.push(full);
    }
  };
  await walk(dir, 0);
  return results;
}

function isWithin(dir: string, file: string): boolean {
  const relative = path.relative(dir, path.resolve(file));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
