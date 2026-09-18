const {test}=require('node:test');
const assert=require('node:assert/strict');
const X=require('../lib/excel-export');
test('Excel aggregates seconds and preserves attempts without invented legacy progress',()=>{
 const data={sessions:[{schemaVersion:2,id:'one',watchMs:1250,daily:{'2026-09-13':{watchMs:1250}},practicedWordIds:['a','a'],practicedSentenceIds:[]},{id:'old',daily:{'2026-09-13':{reviewMs:750}}}],challenges:{sessions:[{attempts:[{score:{points:3,maxPoints:10,passed:false}},{score:{points:8,maxPoints:10,passed:true}}]}]}};
 const t=X.tables(data);assert.equal(t[0].rows[1][1],2);assert.equal(t[1].rows[1][10],1);assert.equal(t[1].rows[2][10],'');assert.equal(t[2].rows.length,3);assert.equal(t[2].rows[1][7],3);assert.equal(t[2].rows[2][7],8);
});
test('Excel uses plain text and excludes secrets',()=>{
 const b=X.build({parentKey:'DO_NOT_EXPORT',sessions:[{videoTitle:'=SUM(1,2) & <title>',startedAt:1e99}]});
 const s=new TextDecoder().decode(b);assert.equal(b[0],80);assert.equal(b[1],75);assert.ok(s.includes('=SUM(1,2) &amp; &lt;title&gt;'));assert.ok(!s.includes('<f>'));assert.ok(!s.includes('DO_NOT_EXPORT'));assert.ok(s.includes('state="frozen"'));assert.equal(X.tables({}).length,4);
});
test('library Excel has Vocabulary and Sentences sheets with the exact requested columns',()=>{
 const entries=[
  {id:'word-1',kind:'word',term:'resilient',phonetic:'/rɪˈzɪliənt/',meaningZh:'有韧性的',sourceExcerpt:'She is resilient.'},
  {id:'sentence-1',kind:'sentence',term:'What matters is how we respond.',translationZh:'重要的是我们如何应对。',sourceExcerpt:'What matters is how we respond.'},
  {id:'word-1',kind:'word',term:'duplicate',meaningZh:'不应出现'},
 ];
 const sheets=X.libraryTables(entries),header=['单词','音标','释义','例句'];
 assert.deepEqual(sheets.map(sheet=>sheet.name),['生词','长难句']);
 assert.deepEqual(sheets[0].rows[0],header);assert.deepEqual(sheets[1].rows[0],header);
 assert.deepEqual(sheets[0].rows[1],['resilient','/rɪˈzɪliənt/','有韧性的','She is resilient.']);
 assert.deepEqual(sheets[1].rows[1],['What matters is how we respond.','','重要的是我们如何应对。','What matters is how we respond.']);
 assert.equal(sheets[0].rows.length,2);
});
test('library Excel keeps legacy rows, writes formulas as plain text and excludes unrelated fields',()=>{
 const bytes=X.buildLibrary([{kind:'word',term:'=HYPERLINK("bad")',meaningZh:'<&>',context:'example',secret:'DO_NOT_EXPORT'}]);
 const text=new TextDecoder().decode(bytes);
 assert.equal(bytes[0],80);assert.equal(bytes[1],75);assert.ok(text.includes('生词'));assert.ok(text.includes('长难句'));
 assert.ok(text.includes('=HYPERLINK(&quot;bad&quot;)'));assert.ok(!text.includes('<f>'));assert.ok(!text.includes('DO_NOT_EXPORT'));
});
