/* Bilibili native subtitle adapter, using the existing port's MIT API modules. */
var YTD_BILIBILI = (()=>{
  const P=typeof YTD_PLATFORM!=='undefined'?YTD_PLATFORM:require('./platform.js');
  const A=typeof BILI_API!=='undefined'?BILI_API:require('./bili-api.js');
  async function fetchTranscript(id,{fetchImpl=fetch,mode='native'}={}){
    try{
      const parts=P.biliParts(id);if(!parts)throw new Error('无法识别 B 站视频号。');
      if(mode!=='native')return {success:false,error:'BILI_NATIVE_ONLY',message:'B 站版读取网站提供的字幕，暂不提供无字幕视频的音频转写。'};
      const bounded=async(url,options={})=>{
        const u=new URL(url);if(u.protocol!=='https:' || !(u.hostname==='api.bilibili.com'||u.hostname.endsWith('.hdslb.com')))throw new Error('字幕接口返回了不支持的地址。');
        const response=await fetchImpl(url,{...options,signal:AbortSignal.timeout(30000),redirect:'error'});
        let raw='';const limit=8*1024*1024;
        if(response.body?.getReader){const reader=response.body.getReader(),decoder=new TextDecoder();let total=0;
          try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw new Error('字幕响应过大，请使用较短的视频。');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
        }else raw=await response.text();
        if(raw.length>limit)throw new Error('字幕响应过大，请使用较短的视频。');
        return {ok:response.ok,status:response.status,json:async()=>JSON.parse(raw)};
      };
      const info=await A.fetchVideoInfo(parts.bvid,{page:parts.page,fetchImpl:bounded});
      if(parts.page>info.pageCount)throw new Error("该视频不存在这个分 P，请重新打开视频页。");
      const {tracks,needLogin}=await A.fetchSubtitleTracks(info,{fetchImpl:bounded});
      if(!tracks.length)return {success:false,error:needLogin?'BILI_LOGIN_REQUIRED':'BILI_NO_SUBTITLE',message:needLogin?'请先在当前 Chrome 用户配置登录哔哩哔哩，再重新获取字幕。':'这个视频没有可读取的字幕。画面内嵌字幕无法直接提取，请选择提供字幕轨的视频。'};
      const track=A.pickSubtitleTrack(tracks,['en','en-US','en-GB','ai-en','zh-CN','zh-Hans','ai-zh']);
      const transcript=await A.fetchSubtitleTrackContent(track.url,{fetchImpl:bounded});
      if(!transcript.length)throw new Error('字幕内容为空。');
      if(transcript.length>20000 || transcript.some(s=>!Number.isFinite(s.start)||!Number.isFinite(s.duration)))throw new Error('字幕时间或内容无效。');
      return {success:true,transcript,transcriptText:transcript.map(s=>s.text).join(' '),
        transcriptTimestamped:transcript.map(s=>`[${Math.floor(s.start/60)}:${String(Math.floor(s.start%60)).padStart(2,'0')}] ${s.text}`).join('\n'),
        language:track.lang,source:'native',videoTitle:info.title,channelName:info.owner};
    }catch(e){return {success:false,error:'BILI_TRANSCRIPT_ERROR',message:e.name==='TimeoutError'?'B 站字幕请求超时，请重试。':e.message};}
  }
  return {fetchTranscript};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=YTD_BILIBILI;
