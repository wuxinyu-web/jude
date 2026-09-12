const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),dependency=path.resolve(path.dirname(require.resolve('docx')),'..');
const expected=require('../package.json').devDependencies.docx;
const actual=JSON.parse(fs.readFileSync(path.join(dependency,'package.json'),'utf8')).version;
if(actual!==expected)throw new Error(`Expected docx ${expected}, got ${actual}`);
fs.mkdirSync(path.join(root,'vendor'),{recursive:true});
fs.copyFileSync(path.join(dependency,'dist/index.umd.cjs'),path.join(root,'vendor/docx.umd.js'));
fs.copyFileSync(path.join(dependency,'LICENSE'),path.join(root,'vendor/docx.LICENSE'));
console.log(`Vendored docx ${actual}`);
