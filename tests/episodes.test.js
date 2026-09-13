const test=require('node:test');const assert=require('node:assert/strict');
const P=require('../lib/platform');const A=require('../lib/bili-api');
test('official episode IDs and source links retain the exact episode',()=>{
 assert.deepEqual(P.parse('https://www.bilibili.com/bangumi/play/ep818207?spm_id_from=test'),{platform:'bilibili',id:'bili_ep818207',episodeId:818207,page:1});
 assert.equal(P.sourceUrl('bili_ep818207',125),'https://www.bilibili.com/bangumi/play/ep818207?t=125');
 assert.equal(P.parse('https://www.bilibili.com/bangumi/play/ep0'),null);
 assert.equal(P.parse('https://evil.test/bangumi/play/ep818207'),null);
});
test('episode metadata selects exact requested episode, including section lists',async()=>{
 const fetchImpl=async()=>({ok:true,json:async()=>({code:0,result:{title:'Series',season_id:5,episodes:[{id:1,aid:10,cid:20,title:'1'}],section:[{episodes:[{id:2,aid:11,cid:21,bvid:'BV112421K7mo',title:'2',duration:120000}]}]}})});
 const i=await A.fetchEpisodeInfo(2,{fetchImpl});assert.equal(i.cid,21);assert.equal(i.episodeId,2);assert.equal(i.duration,120);
 await assert.rejects(A.fetchEpisodeInfo(3,{fetchImpl}),/未找到/);
});
test('subtitle request includes episode identifiers and preserves login-required state',async()=>{
 let params;
 const result=await A.fetchSubtitleTracks({aid:1,cid:2,bvid:'BV112421K7mo',episodeId:818207,seasonId:5},{wbi:{fetchWbiKeys:async()=>({}),signedUrl:(_u,p)=>{params=p;return 'https://api.bilibili.com/x/player/wbi/v2';}},fetchImpl:async()=>({ok:true,json:async()=>({code:0,data:{need_login_subtitle:true,subtitle:{subtitles:[]}}})})});
 assert.equal(params.ep_id,818207);assert.equal(params.season_id,5);assert.equal(result.needLogin,true);
});
