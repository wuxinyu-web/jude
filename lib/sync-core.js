/* Pure local-first sync transforms. Secrets and device-only caches are excluded. */
var YTD_SYNC_CORE = (() => {
  const SPECS = Object.freeze([
    {key:'ytd_vocabulary', kind:'array'},
    {key:'ytd_sentences', kind:'array'},
    {key:'ytd_notes', kind:'array'},
    {key:'ytd_reviews', kind:'map'},
    {key:'ytd_study', kind:'sessions'},
    {key:'ytd_challenges', kind:'sessions'},
    {key:'ytd_learning_preferences', kind:'single'},
  ]);
  const KEYS = Object.freeze(SPECS.map(spec=>spec.key));
  const specByKey = new Map(SPECS.map(spec=>[spec.key,spec]));
  const RUNTIME_FIELDS=['currentId','tabId','windowId','documentId','runtimeBoot','boot','lastSample','timerKind','timerReason','needsResume','restorePlayback','replay','rewatchToken'];

  function stable(value){
    if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
    if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
    return JSON.stringify(value);
  }
  function recordKey(key,id){return `${key}/${encodeURIComponent(id)}`;}
  function parseRecordKey(key){
    const slash=key.indexOf('/');if(slash<1)return null;
    const namespace=key.slice(0,slash),spec=specByKey.get(namespace);if(!spec)return null;
    try{const id=decodeURIComponent(key.slice(slash+1));if(!id||id.length>300||['__proto__','constructor','prototype'].includes(id))return null;return {namespace,id,spec};}catch{return null;}
  }
  function currentRecords(data){
    const out={};
    for(const spec of SPECS){
      const value=data?.[spec.key];
      if(spec.kind==='array'){
        for(const item of Array.isArray(value)?value:[])if(item&&typeof item==='object'&&typeof item.id==='string'&&item.id)out[recordKey(spec.key,item.id)]=item;
      }else if(spec.kind==='map'){
        if(value&&typeof value==='object'&&!Array.isArray(value))for(const [id,item]of Object.entries(value))out[recordKey(spec.key,id)]=item;
      }else if(spec.kind==='sessions'){
        if(value&&typeof value==='object'&&!Array.isArray(value)){
          out[recordKey(spec.key,'$meta')]={schemaVersion:value.schemaVersion||1};
          for(const item of Array.isArray(value.sessions)?value.sessions:[])if(item&&typeof item.id==='string'&&item.id)out[recordKey(spec.key,item.id)]=Object.fromEntries(Object.entries(item).filter(([key])=>!RUNTIME_FIELDS.includes(key)));
        }
      }else if(spec.kind==='single'&&value!==undefined){
        out[recordKey(spec.key,'$value')]=value;
      }
    }
    return out;
  }
  function reconcile(data,previous={},deviceId,now=Date.now()){
    const current=currentRecords(data),records={...previous};
    for(const [key,value]of Object.entries(current)){
      const old=records[key];
      if(!old||old.value===null||stable(old.value)!==stable(value))records[key]={value,updatedAt:now,deviceId};
    }
    for(const [key,old]of Object.entries(records)){
      if(!parseRecordKey(key)||Object.hasOwn(current,key)||old?.value===null)continue;
      records[key]={value:null,updatedAt:now,deviceId};
    }
    return records;
  }
  function validRecord(value){return value&&typeof value==='object'&&Number.isSafeInteger(value.updatedAt)&&value.updatedAt>0&&typeof value.deviceId==='string'&&value.deviceId.length>0&&value.deviceId.length<=100&&('value'in value);}
  function validateRecords(records){
    if(!records||typeof records!=='object'||Array.isArray(records)||Object.keys(records).length>5000)throw Error('同步数据格式无效。');
    for(const [key,record]of Object.entries(records)){
      const parsed=parseRecordKey(key);
      if(!parsed||!validRecord(record))throw Error('同步记录无效。');
      const value=record.value;if(value===null)continue;
      if(!value||typeof value!=='object'||Array.isArray(value))throw Error('同步内容无效。');
      if(['array','sessions'].includes(parsed.spec.kind)&&parsed.id!=='$meta'&&value.id!==parsed.id)throw Error('同步记录编号不匹配。');
    }
    return records;
  }
  function merge(local={},remote={}){
    const out={};
    for(const key of new Set([...Object.keys(local),...Object.keys(remote)])){
      const a=validRecord(local[key])?local[key]:null,b=validRecord(remote[key])?remote[key]:null;
      if(!a)out[key]=b;else if(!b)out[key]=a;
      else out[key]=(a.updatedAt>b.updatedAt||(a.updatedAt===b.updatedAt&&a.deviceId>=b.deviceId))?a:b;
    }
    return Object.fromEntries(Object.entries(out).filter(([,value])=>value));
  }
  function materialize(records={}){
    const grouped=new Map(SPECS.map(spec=>[spec.key,[]]));
    for(const [key,record]of Object.entries(records)){
      const parsed=parseRecordKey(key);if(!parsed||!validRecord(record)||record.value===null)continue;
      grouped.get(parsed.namespace).push({id:parsed.id,value:record.value,updatedAt:record.updatedAt});
    }
    const out={};
    for(const spec of SPECS){
      const items=grouped.get(spec.key);
      if(spec.kind==='array')out[spec.key]=items.filter(x=>x.id!=='$meta'&&x.id!=='$value').map(x=>x.value).sort((a,b)=>(Number(b.createdAt)||0)-(Number(a.createdAt)||0));
      else if(spec.kind==='map')out[spec.key]=Object.fromEntries(items.filter(x=>x.id!=='$meta'&&x.id!=='$value').map(x=>[x.id,x.value]));
      else if(spec.kind==='sessions'){
        const meta=items.find(x=>x.id==='$meta')?.value;
        const sessions=items.filter(x=>x.id!=='$meta'&&x.id!=='$value').map(x=>x.value).sort((a,b)=>(Number(a.createdAt)||0)-(Number(b.createdAt)||0));
        out[spec.key]={schemaVersion:meta?.schemaVersion||(spec.key==='ytd_study'?2:1),currentId:sessions.some(s=>s.id===meta?.currentId)?meta.currentId:null,sessions};
      }else if(spec.kind==='single'){
        const item=items.find(x=>x.id==='$value');out[spec.key]=item?item.value:{};
      }
    }
    return out;
  }
  function publicConfig(config={}){return {loggedIn:config.provider==='supabase-v1'&&Boolean(config.accessToken),email:config.email||'',provider:config.provider||'',lastSyncAt:config.lastSyncAt||0,lastError:config.lastError||''};}
  return {KEYS,SPECS,RUNTIME_FIELDS,validateRecords,stable,currentRecords,reconcile,merge,materialize,publicConfig,parseRecordKey};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=YTD_SYNC_CORE;
