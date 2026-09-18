/* Local XLSX writer: inline strings, numeric values and an uncompressed ZIP.
 * No formulas, macros, external connections, or third-party requests. */
var YTD_EXCEL=(()=>{
 const enc=new TextEncoder();
 const xml=v=>String(v??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').slice(0,32767).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 const num=v=>(Number.isFinite(Number(v))?Math.max(0,Number(v)):0),sec=v=>Math.round(num(v))/1000;
 const count=v=>Array.isArray(v)?new Set(v).size:'';
 const date=v=>Number(v)>0&&Number.isFinite(new Date(Number(v)).getTime())?new Date(Number(v)).toISOString():'';
 function tables(data={}){
  const sessions=Array.isArray(data.sessions)?data.sessions:[],daily=new Map();
  const tasks=[['任务标识','视频标题','视频标识','开始时间（UTC）','状态','有效学习（秒）','观看（秒）','字幕与词句（秒）','翻卡（秒）','目标时长（秒）','已练单词','单词目标','已练句子','句子目标','待复习','播放位置（秒）']];
  for(const s of sessions){
   for(const [day,b] of Object.entries(s.daily||{})){if(!/^\d{4}-\d{2}-\d{2}$/.test(day))continue;const row=daily.get(day)||[0,0,0];['watchMs','activityMs','reviewMs'].forEach((k,i)=>row[i]+=num(b?.[k]));daily.set(day,row);}
   tasks.push([s.id,s.videoTitle,s.videoId,date(s.startedAt||s.createdAt),({running:'学习中',paused:'已暂停',ended:'已结束'})[s.status]||s.status,sec(num(s.watchMs)+num(s.activityMs)+num(s.reviewMs)),sec(s.watchMs),sec(s.activityMs),sec(s.reviewMs),sec(s.targetMs),s.schemaVersion===2?count(s.practicedWordIds):'',s.wordGoal??'',s.schemaVersion===2?count(s.practicedSentenceIds):'',s.sentenceGoal??'',s.schemaVersion===2?Object.values(s.practiceResults||{}).filter(r=>r?.result!=='known').length:'',num(s.position)]);
  }
  const days=[['日期（本机日期）','有效学习（秒）','观看（秒）','字幕与词句（秒）','翻卡（秒）'],...[...daily].sort(([a],[b])=>a.localeCompare(b)).map(([day,v])=>[day,sec(v.reduce((a,b)=>a+b,0)),...v.map(sec)])];
  const exams=[['任务标识','视频标题','模式','任务状态','提交次数','提交时间（UTC）','本次通过','得分','满分','单词答对','单词题数','句子答对','句子题数','短语答对','短语题数']];
  for(const s of data.challenges?.sessions||[]){const attempts=s.attempts||[];for(const [i,a] of (attempts.length?attempts:[null]).entries()){const score=a?.score;exams.push([s.id,s.videoTitle,s.parentMode?'家长模式':'普通闯关',({passed:'已完成',exited:'已退出',watching:'观看中',quiz:'待测试',review:'待复习',retry:'待补测',generating:'出题中',grading:'判题中'})[s.status]||s.status,a?i+1:0,date(a?.at),a?(score?.passed?'是':'否'):'未提交',score?.points??'',score?.maxPoints??'',score?.word?.correct??'',score?.word?.total??'',score?.sentence?.correct??'',score?.sentence?.total??'',score?.phrase?.correct??'',score?.phrase?.total??'']);}}
  return [{name:'每日统计',rows:days},{name:'学习任务',rows:tasks},{name:'测试成绩',rows:exams},{name:'说明',rows:[['项目','说明'],['导出时间（UTC）',date(data.exportedAt)],['范围','本机保留的学习记录，通常为最近 90 天；不包含收藏正文或家长密钥。'],['单位','学习时长与播放位置均为秒，可包含小数；每日统计沿用记录中的本机日期。'],['旧记录','缺失的练习成果留空；没有每日明细的旧记录只列入学习任务，不推算每日分布。'],['成绩','保留每次提交的实际成绩；未提交测试留空，不把收藏任务完成视为考试通过。'],['隐私','文件在本机生成；视频标题等文本按纯文本写入，不执行公式。']]}];
 }
 function libraryTables(entries=[]){
  const header=['单词','音标','释义','例句'];
  const unique=[],seen=new Set();
  for(const [index,entry] of (Array.isArray(entries)?entries:[]).entries()){
   if(!entry||!['word','sentence'].includes(entry.kind)||!String(entry.term||'').trim())continue;
   const key=typeof entry.id==='string'&&entry.id?`${entry.kind}:${entry.id}`:`${entry.kind}:${entry.term}:${entry.createdAt||index}`;
   if(seen.has(key))continue;
   seen.add(key);unique.push(entry);
  }
  const rows=kind=>[header,...unique.filter(entry=>entry.kind===kind).map(entry=>[
   entry.term||'',kind==='word'?(entry.phonetic||''):'',
   kind==='word'?(entry.meaningZh||entry.explanationZh||''):(entry.translationZh||entry.meaningZh||''),
   entry.sourceExcerpt||entry.context||''
  ])];
  return [
   {name:'生词',rows:rows('word'),widths:[28,18,36,64]},
   {name:'长难句',rows:rows('sentence'),widths:[58,18,42,64]}
  ];
 }
 function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
 function zip(files){const chunks=[],central=[];let offset=0;const header=n=>new Uint8Array(n);const put=(b,o,v,n=4)=>{const d=new DataView(b.buffer);n===2?d.setUint16(o,v,true):d.setUint32(o,v,true);};
  for(const [name,text]of Object.entries(files)){const nameBytes=enc.encode(name),body=enc.encode(text),sum=crc(body),local=header(30);put(local,0,0x04034b50);put(local,4,20,2);put(local,10,0,2);put(local,12,33,2);put(local,14,sum);put(local,18,body.length);put(local,22,body.length);put(local,26,nameBytes.length,2);chunks.push(local,nameBytes,body);
   const c=header(46);put(c,0,0x02014b50);put(c,4,20,2);put(c,6,20,2);put(c,14,33,2);put(c,16,sum);put(c,20,body.length);put(c,24,body.length);put(c,28,nameBytes.length,2);put(c,42,offset);central.push(c,nameBytes);offset+=local.length+nameBytes.length+body.length;}
  const size=central.reduce((n,b)=>n+b.length,0),end=header(22);put(end,0,0x06054b50);put(end,8,central.length/2,2);put(end,10,central.length/2,2);put(end,12,size);put(end,16,offset);const all=[...chunks,...central,end],out=new Uint8Array(offset+size+22);let p=0;for(const b of all){out.set(b,p);p+=b.length;}return out;
 }
 const col=i=>{let s='';for(i++;i>0;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;};
 function buildSheets(sheets){const files={},ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  files['[Content_Types].xml']=`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const rels=entries=>`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map(([id,type,target])=>`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join('')}</Relationships>`;
  files['_rels/.rels']=rels([['rId1','officeDocument','xl/workbook.xml']]);
  files['xl/workbook.xml']=`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`;
  files['xl/_rels/workbook.xml.rels']=rels([...sheets.map((_,i)=>[`rId${i+1}`,'worksheet',`worksheets/sheet${i+1}.xml`]),['styles','styles','styles.xml']]);
  files['xl/styles.xml']=`<styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF315944"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf><xf fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  sheets.forEach((s,i)=>{files[`xl/worksheets/sheet${i+1}.xml`]=`<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${s.rows[0].map((_,j)=>`<col min="${j+1}" max="${j+1}" width="${s.widths?.[j]??(s.name==='说明'&&j===1?90:j===1&&s.name!=='每日统计'?38:22)}" customWidth="1"/>`).join('')}</cols><sheetData>${s.rows.map((row,r)=>`<row r="${r+1}"${r===0?' ht="32" customHeight="1"':''}>${row.map((v,c)=>typeof v==='number'&&Number.isFinite(v)?`<c r="${col(c)}${r+1}" s="${r===0?1:0}"><v>${v}</v></c>`:`<c r="${col(c)}${r+1}" s="${r===0?1:0}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData><autoFilter ref="A1:${col(s.rows[0].length-1)}${s.rows.length}"/></worksheet>`;});return zip(files);
 }
 const build=data=>buildSheets(tables(data));
 const buildLibrary=entries=>buildSheets(libraryTables(entries));
 const mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
 return {tables,libraryTables,build,buildLibrary,toBlob:data=>new Blob([build(data)],{type:mime}),libraryToBlob:entries=>new Blob([buildLibrary(entries)],{type:mime})};
})();
if(typeof module!=='undefined')module.exports=YTD_EXCEL;
