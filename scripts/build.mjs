import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
await mkdir(new URL('../dist/',import.meta.url),{recursive:true});
await build({entryPoints:['src/host/index.ts'],outfile:'dist/index.js',bundle:true,format:'esm',platform:'node',target:'node24',external:['@deepseek-ai/cordis','@deepseek-ai/dsh-typert-protocol'],sourcemap:true});
const css=await readFile('src/client/styles.css','utf8');
const result=await build({entryPoints:['src/client/index.tsx'],bundle:true,format:'cjs',platform:'browser',target:'es2022',external:['react'],write:false,define:{'__GROUP_STYLES__':JSON.stringify(css)},minify:false});
const code=result.outputFiles[0].text;
await writeFile('dist/client.js',`window.__ModuleLoader__.load({id:'dsh-session-group',factory(require){var module={exports:{}};var exports=module.exports;\n${code}\nreturn module.exports;}});\n`);
console.log('Built Host and Client plugin entries.');
