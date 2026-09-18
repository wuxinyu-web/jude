const test=require("node:test"),assert=require("node:assert/strict"),zlib=require("node:zlib");
const W=require("../lib/word-export.js"),D=require("../vendor/docx.umd.js");
function unzip(buffer){
  const files={};let end=buffer.length-22;while(end>=0 && buffer.readUInt32LE(end)!==0x06054b50)end--;
  let offset=buffer.readUInt32LE(end+16),count=buffer.readUInt16LE(end+10);
  for(let i=0;i<count;i++){
    const size=buffer.readUInt32LE(offset+20),method=buffer.readUInt16LE(offset+10),nameSize=buffer.readUInt16LE(offset+28),extra=buffer.readUInt16LE(offset+30),comment=buffer.readUInt16LE(offset+32),local=buffer.readUInt32LE(offset+42);
    const name=buffer.subarray(offset+46,offset+46+nameSize).toString();const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28),compressed=buffer.subarray(start,start+size);
    files[name]=(method===8?zlib.inflateRawSync(compressed):compressed).toString();offset+=46+nameSize+extra+comment;
  }return files;
}
const word={id:"w",kind:"word",term:"perspective",phonetic:"/pəˈspektɪv/",meaningZh:"看法",explanationZh:"对事情的理解方式",sourceExcerpt:"A book changed my perspective.",videoTitle:"English learning",videoId:"abcDEF12345",timestamp:"1:02",timestampSeconds:62};
const sentence={id:"s",kind:"sentence",term:"The book which she recommended changed my perspective.",translationZh:"她推荐的那本书改变了我的看法。",mainClause:"The book changed my perspective.",breakdown:"which she recommended 修饰 book。",grammarTags:["定语从句"],expressionTags:["普通表达"],analysisStatus:"ready",videoTitle:"English learning",videoId:"abcDEF12345",timestamp:"1:02",timestampSeconds:62};
test("handout is real A4 OOXML with CJK font, safe hyperlinks, page fields and unique entries",async()=>{
  const files=unzip(await D.Packer.toBuffer(W.buildDocument([word,sentence,word],{date:"2026-09-12"})));
  const xml=files["word/document.xml"];assert.match(xml,/英语词句学习讲义/);assert.match(xml,/看法/);assert.match(xml,/结构拆解/);assert.match(xml,/11906/);assert.match(xml,/16838/);
  assert.equal((xml.match(/1  perspective/g)||[]).length,1);assert.match(files["word/styles.xml"],/Songti SC/);assert.match(files["word/footer1.xml"],/PAGE/);
  assert.match(files["word/_rels/document.xml.rels"],/https:\/\/www.youtube.com\/watch/);assert.doesNotMatch(Object.values(files).join(""),/apiKey|supadata|deepseek/i);
});
test("self-test has matching question/answer numbers and starts answers on a new page",async()=>{
  const xml=unzip(await D.Packer.toBuffer(W.buildDocument([word,sentence],{mode:"quiz"})))["word/document.xml"];
  const answerAt=xml.indexOf("参考答案"),meaningAt=xml.indexOf("看法");assert.ok(answerAt>0&&meaningAt<answerAt);
  assert.match(xml.slice(answerAt-350,answerAt),/pageBreakBefore/);
  const questions=xml.slice(0,answerAt);assert.match(questions,/她推荐的那本书改变了我的看法/);assert.doesNotMatch(questions,/perspective|The book|A book|English learning/);
  assert.equal((xml.match(/1  perspective/g)||[]).length,1);assert.equal((xml.match(/2  The book/g)||[]).length,1);assert.match(xml,/_{20}/);
});
test("unfinished analysis is explicit, arbitrary source fields are excluded and XML text is escaped",async()=>{
  const xml=unzip(await D.Packer.toBuffer(W.buildDocument([{...sentence,term:"If A < B & C",analysisStatus:"error",apiKey:"NOT_FOR_EXPORT"}])))["word/document.xml"];
  assert.match(xml,/解析尚未完成/);assert.match(xml,/&lt; B &amp; C/);assert.doesNotMatch(xml,/NOT_FOR_EXPORT/);
});
test('Bilibili handout and quiz source links preserve part and timestamp',async()=>{
  for(const mode of ['handout','quiz']){
    const files=unzip(await D.Packer.toBuffer(W.buildDocument([{...word,videoId:'BV1xx411c7mD_p2'}],{mode})));
    assert.match(files['word/_rels/document.xml.rels'],/https:\/\/www.bilibili.com\/video\/BV1xx411c7mD\/\?p=2&amp;t=62/);
    assert.doesNotMatch(files['word/_rels/document.xml.rels'],/youtube.com/);
  }
});

test("quiz missing Chinese prompts stays explicit without exposing English answers",async()=>{
 const xml=unzip(await D.Packer.toBuffer(W.buildDocument([{...word,meaningZh:""},{...sentence,translationZh:"",analysisStatus:"error"}],{mode:"quiz"})))["word/document.xml"];
 const questions=xml.slice(0,xml.indexOf("参考答案"));assert.equal((questions.match(/中文题目尚未准备好/g)||[]).length,2);assert.doesNotMatch(questions,/perspective|The book/);assert.match(xml.slice(xml.indexOf("参考答案")),/perspective/);
});

test('combined export retains the complete handout then separates Chinese questions and answers onto new pages',async()=>{
 const xml=unzip(await D.Packer.toBuffer(W.buildDocument([word,sentence],{mode:'handout-quiz'})))['word/document.xml'];
 const testAt=xml.indexOf('词句测试题'),answerAt=xml.indexOf('参考答案</w:t>');
 assert.ok(testAt>xml.indexOf('结构拆解'));assert.ok(answerAt>testAt);
 assert.match(xml.slice(testAt-350,testAt),/pageBreakBefore/);assert.match(xml.slice(answerAt-350,answerAt),/pageBreakBefore/);
 const questions=xml.slice(testAt,answerAt-350);assert.match(questions,/她推荐的那本书/);assert.doesNotMatch(questions,/perspective|The book/);
 assert.equal((xml.match(/1  perspective/g)||[]).length,2);
 const pure=unzip(await D.Packer.toBuffer(W.buildDocument([word,sentence],{mode:'handout'})))['word/document.xml'];assert.doesNotMatch(pure,/词句测试题|参考答案/);
});
test('combined export filters unsuitable test material while preserving handout and numbering safe answers',async()=>{
 const xml=unzip(await D.Packer.toBuffer(W.buildDocument([{...word,term:'fuck'},sentence],{mode:'handout-quiz'})))['word/document.xml'];
 const testAt=xml.indexOf('词句测试题');assert.match(xml.slice(0,testAt),/fuck/);assert.doesNotMatch(xml.slice(testAt),/fuck/);assert.match(xml.slice(testAt),/共 1 题/);assert.match(xml.slice(testAt),/1  The book/);
});
