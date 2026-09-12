const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const P=require('../lib/platform.js'),C=require('../lib/learning-core.js'),B=require('../lib/bilibili-transcript.js');
const id='BV1xx411c7mD';
test('Bilibili video/list URLs and parts have distinct canonical storage identities',()=>{
 assert.equal(P.videoIdFromUrl(`https://www.bilibili.com/video/${id}/?p=2&share_source=copy`),`${id}_p2`);
 assert.equal(P.videoIdFromUrl(`https://www.bilibili.com/list/ml123?bvid=${id}&p=3`),`${id}_p3`);
 assert.equal(P.videoIdFromUrl(`https://www.bilibili.com/video/${id}/`),id);
 for(const url of [`https://www.bilibili.com.evil.test/video/${id}`,`http://www.bilibili.com/video/${id}`,`https://www.bilibili.com/video/${id}/?p=-1`])assert.equal(P.videoIdFromUrl(url),null);
 assert.equal(P.sourceUrl(`${id}_p2`,62),`https://www.bilibili.com/video/${id}/?p=2&t=62`);
 assert.equal(P.sourceUrl('abcDEF12345',62),'https://www.youtube.com/watch?v=abcDEF12345&t=62s');
});
test('sentence source URLs and study identity retain Bilibili part number',()=>{
 const s=C.makeSentence({videoId:`${id}_p2`,timestamp:62,term:'If only.'},1,'s');
 assert.equal(s.timestampedUrl,P.sourceUrl(`${id}_p2`,62));assert.equal(C.videoIdFromUrl(s.timestampedUrl),`${id}_p2`);
});
function fixture({tracks=true,login=false,url='https://aisubtitle.hdslb.com/test.json',subtitle=[]}={}){
 const calls=[];const fetchImpl=async(u,o)=>{calls.push({url:String(u),options:o});let data;
 if(String(u).includes('/view?'))data={code:0,data:{aid:1,bvid:id,title:'英语',owner:{name:'老师'},pages:[{page:1,cid:10},{page:2,cid:20,part:'第二节'}]}};
 else if(String(u).includes('/nav'))data={data:{wbi_img:{img_url:'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',sub_url:'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'}}};
 else if(String(u).includes('/player/'))data={code:0,data:{need_login_subtitle:login,subtitle:{subtitles:tracks?[{lan:'zh-CN',subtitle_url:'https://aisubtitle.hdslb.com/zh.json'},{lan:'en',subtitle_url:url}]:[]}}};
 else data={body:subtitle.length?subtitle:[{from:1,to:4,content:'Keep learning.'}]};
 return new Response(JSON.stringify(data),{status:200});};return {calls,fetchImpl};
}
test('native Bilibili pipeline uses part CID, English track and no provider key or cookies at CDN',async()=>{
 const f=fixture();const r=await B.fetchTranscript(`${id}_p2`,f);
 assert.equal(r.success,true);assert.equal(r.language,'en');assert.equal(r.videoTitle,'第二节');assert.equal(r.transcript[0].text,'Keep learning.');
 const api=f.calls.find(c=>c.url.includes('/player/'));assert.match(api.url,/cid=20/);assert.match(api.url,/w_rid=/);
 assert.equal(api.options.credentials,'include');assert.equal(f.calls.at(-1).options.credentials,'omit');assert.equal(f.calls.length,4);
 assert.ok(f.calls.every(c=>!Object.keys(c.options.headers).some(k=>k.toLowerCase().includes('key'))));
});
test('missing/login-required subtitles, hostile CDN and nonexistent parts fail explicitly',async()=>{
 assert.equal((await B.fetchTranscript(id,fixture({tracks:false,login:true}))).error,'BILI_LOGIN_REQUIRED');
 assert.equal((await B.fetchTranscript(id,fixture({tracks:false}))).error,'BILI_NO_SUBTITLE');
 const f=fixture({url:'https://evil.test/captions'});assert.equal((await B.fetchTranscript(id,f)).success,false);assert.ok(f.calls.every(c=>!c.url.includes('evil.test')));
 assert.equal((await B.fetchTranscript(`${id}_p3`,fixture())).success,false);
 assert.equal((await B.fetchTranscript(id,{...fixture(),mode:'generate'})).error,'BILI_NATIVE_ONLY');
});
test('Chinese UI, persistent follow control and optional YouTube key are part of runtime files',()=>{
 const html=fs.readFileSync('sidepanel.html','utf8'),options=fs.readFileSync('options.html','utf8'),js=fs.readFileSync('options.js','utf8');
 assert.match(html,/id="followPlaybackToggle"/);for(const label of ['字幕','概览','收藏库','学习'])assert.ok(html.includes(`>${label}</button>`));
 assert.match(options,/哔哩哔哩字幕/);assert.match(options,/保存设置/);assert.doesNotMatch(js,/if \(!settings.supadataApiKey\)/);
});
