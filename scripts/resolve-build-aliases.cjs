// TypeScript paths guide compilation but are not rewritten by tsc. Resolve only
// those local aliases in emitted JS; leave relative imports and packages intact.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '..');
const configFile = ts.readConfigFile(path.join(projectRoot, 'tsconfig.json'), ts.sys.readFile);
if (configFile.error)
  throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectRoot);
if (config.errors.length)
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(config.errors, {
      getCurrentDirectory: () => projectRoot,
      getCanonicalFileName: (name) => name,
      getNewLine: () => '\n',
    })
  );
const { rootDir, outDir, paths } = config.options;
const aliasPrefixes = Object.keys(paths).map((alias) => alias.replace(/\*$/, ''));

for (const sourceFile of config.fileNames) {
  if (sourceFile.endsWith('.d.ts')) continue;
  const outputFile = path
    .join(outDir, path.relative(rootDir, sourceFile))
    .replace(/\.tsx?$/, '.js');
  const original = fs.readFileSync(outputFile, 'utf8');
  const ast = ts.createSourceFile(
    outputFile,
    original,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const replacements = [];
  function visit(node) {
    if (ts.isStringLiteral(node) && aliasPrefixes.some((prefix) => node.text.startsWith(prefix))) {
      const parent = node.parent;
      const isModuleSpecifier =
        ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
          parent.moduleSpecifier === node) ||
        (ts.isCallExpression(parent) &&
          parent.arguments[0] === node &&
          ((ts.isIdentifier(parent.expression) && parent.expression.text === 'require') ||
            parent.expression.kind === ts.SyntaxKind.ImportKeyword));
      if (isModuleSpecifier) {
        const resolution = ts.resolveModuleName(
          node.text,
          sourceFile,
          config.options,
          ts.sys
        ).resolvedModule;
        if (
          !resolution ||
          resolution.isExternalLibraryImport ||
          resolution.resolvedFileName.endsWith('.d.ts')
        ) {
          throw new Error(`Cannot resolve local runtime alias ${node.text} from ${sourceFile}`);
        }
        const relativeSource = path.relative(rootDir, resolution.resolvedFileName);
        if (relativeSource.startsWith('..') || path.isAbsolute(relativeSource)) {
          throw new Error(`Alias escapes source directory: ${node.text}`);
        }
        const target = path.join(outDir, relativeSource).replace(/\.tsx?$/, '.js');
        if (!fs.existsSync(target)) throw new Error(`Missing compiled alias target: ${target}`);
        let relative = path.relative(path.dirname(outputFile), target).replace(/\\/g, '/');
        if (!relative.startsWith('.')) relative = './' + relative;
        replacements.push({
          start: node.getStart(ast),
          end: node.end,
          text: JSON.stringify(relative),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  let rewritten = original;
  for (const replacement of replacements.reverse()) {
    rewritten =
      rewritten.slice(0, replacement.start) + replacement.text + rewritten.slice(replacement.end);
  }
  if (rewritten !== original) fs.writeFileSync(outputFile, rewritten);
}
