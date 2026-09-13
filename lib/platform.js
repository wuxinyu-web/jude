/* Canonical platform identity. Existing YouTube IDs/storage remain unchanged. */
var YTD_PLATFORM = (() => {
  function biliParts(id){const ep=String(id||'').match(/^bili_ep([1-9][0-9]{0,11})$/);if(ep)return {episodeId:Number(ep[1]),page:1};const m=String(id||'').match(/^(BV[0-9A-Za-z]{10})(?:_p([1-9][0-9]{0,3}))?$/);return m?{bvid:m[1],page:Number(m[2]||1)}:null;}
  function parse(url){
    try{const u=new URL(url);if(u.protocol!=='https:')return null;
      if(u.hostname==='www.bilibili.com'){
        const ep=u.pathname.match(/^\/bangumi\/play\/ep([1-9][0-9]{0,11})(?:\/|$)/);
        if(ep)return {platform:'bilibili',id:`bili_ep${ep[1]}`,episodeId:Number(ep[1]),page:1};
        const bv=u.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/)?.[1] || (u.pathname.startsWith('/list/')?u.searchParams.get('bvid'):null);
        if(!/^BV[0-9A-Za-z]{10}$/.test(bv||''))return null;
        const p=Number(u.searchParams.get('p')||1);if(!Number.isInteger(p)||p<1||p>9999)return null;
        return {platform:'bilibili',id:bv+(p>1?`_p${p}`:''),bvid:bv,page:p};
      }
      if(['www.youtube.com','youtube.com'].includes(u.hostname)){
        const id=u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/embed\/([\w-]+)$/)?.[1];
        if(/^[\w-]{6,20}$/.test(id||''))return {platform:'youtube',id};
      }
      if(u.hostname==='youtu.be' && /^[\w-]{6,20}$/.test(u.pathname.slice(1)))return {platform:'youtube',id:u.pathname.slice(1)};
    }catch{}return null;
  }
  function supported(url){try{const u=new URL(url);return u.protocol==='https:'&&['www.youtube.com','www.bilibili.com'].includes(u.hostname);}catch{return false;}}
  function sourceUrl(id,seconds){
    const parts=biliParts(id);let url;
    if(parts?.episodeId){url=new URL(`https://www.bilibili.com/bangumi/play/ep${parts.episodeId}`);}
    else if(parts){url=new URL(`https://www.bilibili.com/video/${parts.bvid}/`);if(parts.page>1)url.searchParams.set('p',parts.page);}
    else{if(!/^[\w-]{6,20}$/.test(String(id||'')))throw new Error('无效的视频编号');url=new URL('https://www.youtube.com/watch');url.searchParams.set('v',id);}
    if(seconds!==undefined)url.searchParams.set('t',String(Math.max(0,Math.floor(Number(seconds)||0)))+(parts?'':'s'));
    return url.toString();
  }
  return {parse,supported,biliParts,sourceUrl,videoIdFromUrl:url=>parse(url)?.id||null};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=YTD_PLATFORM;
