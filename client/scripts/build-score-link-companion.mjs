import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

const sourceUrl = new URL('./score-link-companion.source.js', import.meta.url);
const outputUrl = new URL('../public/score-link-companion.user.js', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const metadataEnd = '// ==/UserScript==';
const endIndex = source.indexOf(metadataEnd);
if (endIndex < 0) throw new Error('USERSCRIPT_METADATA_MISSING');
const header = source.slice(0, endIndex + metadataEnd.length);
const body = source.slice(endIndex + metadataEnd.length);
const result = ts.transpileModule(body, {
  compilerOptions: {
    target: ts.ScriptTarget.ES5,
    module: ts.ModuleKind.CommonJS,
    removeComments: false,
  },
  reportDiagnostics: true,
});
const errors = result.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
if (errors.length) {
  throw new Error(errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n'));
}
await writeFile(outputUrl, `${header}\n${result.outputText}`, 'utf8');
console.log(`Generated ${outputUrl.pathname}`);
