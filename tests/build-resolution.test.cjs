// Run after npm run build. Resolve imports without executing application code,
// contacting providers, starting workers or opening a database connection.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');

test('compiled CommonJS application has resolvable module imports', () => {
  assert.ok(fs.existsSync(path.join(output, 'modules/uploads/uploads.routes.js')));
  let checked = 0;
  function directory(folder) {
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      const filename = path.join(folder, item.name);
      if (item.isDirectory()) {
        directory(filename);
        continue;
      }
      if (!filename.endsWith('.js')) continue;
      const contents = fs.readFileSync(filename, 'utf8');
      const ast = ts.createSourceFile(
        filename,
        contents,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS
      );
      const localRequire = createRequire(filename);
      function visit(node) {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'require' &&
          node.arguments.length === 1 &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          const name = node.arguments[0].text;
          assert.doesNotMatch(
            name,
            /^@(config|core|infrastructure|middleware|modules|shared|routes)\//
          );
          assert.doesNotThrow(() => localRequire.resolve(name), `${filename}: ${name}`);
          checked++;
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
  }
  directory(output);
  assert.ok(checked > 0);
  console.log(`Resolved ${checked} compiled imports without executing modules.`);
});
