/* Real OOXML generated locally with the pinned, bundled docx library. */
var YTD_WORD = (() => {
  const D=typeof docx!=="undefined"?docx:require("../vendor/docx.umd.js");
  const C=typeof YTD_LEARNING!=="undefined"?YTD_LEARNING:require("./learning-core.js");
  function buildDocument(entries,{mode="handout",date=new Date().toLocaleDateString("zh-CN")}={}){
    const {Document,Paragraph,TextRun,HeadingLevel,Footer,PageNumber,AlignmentType,ExternalHyperlink}=D;
    const items=C.uniqueEntries(entries);
    const run=(text,extra={})=>new TextRun({text:String(text||""),...extra});
    const para=(text,options={})=>new Paragraph({children:[run(text)],spacing:{after:140,line:300},...options});
    const children=[para(mode==="quiz"?"英语词句自测":"英语词句学习讲义",{heading:HeadingLevel.TITLE}),
      para(`${date}    共 ${items.length} 项    姓名 ____________________`,{spacing:{after:240}}),
      para(mode==="quiz"?"先独立回忆词义、翻译与句子结构，再核对文末答案。":"结合来源例句理解词义，阅读句子主干与结构拆解，再回到视频复习。")];
    function source(e){
      children.push(para(`来源：${e.videoTitle||"YouTube 视频"}    ${e.timestamp||"0:00"}`,{spacing:{after:80},keepNext:true}));
      const platform=typeof YTD_PLATFORM!=="undefined"?YTD_PLATFORM:require("./platform.js");
      const url=platform.sourceUrl(e.videoId,e.timestampSeconds||0);
      children.push(new Paragraph({children:[new ExternalHyperlink({link:url,children:[run(url,{color:"333333",size:18})]})],spacing:{after:200}}));
    }
    function answer(e){
      if(e.kind==="sentence"){
        if(e.analysisStatus!=="ready"){children.push(para("解析尚未完成，可回到扩展重试。"));return;}
        children.push(para(`中文翻译：${e.translationZh}`),para(`句子主干：${e.mainClause}`),para(`结构拆解：${e.breakdown}`));
        children.push(para(`分类：${[...(e.grammarTags||[]),...(e.expressionTags||[])].join("、")||"未分类"}`));
      }else{
        if(e.phonetic)children.push(para(`音标：${e.phonetic}`));
        children.push(para(`词义：${e.meaningZh||"释义尚未完成"}`),para(`语境用法：${e.explanationZh||""}`));
      }
    }
    items.forEach((e,i)=>{
      children.push(para(`${i+1}  ${e.term}`,{heading:HeadingLevel.HEADING_2,keepNext:true}));
      if(e.kind!=="sentence" && e.sourceExcerpt)children.push(para(`来源例句：${e.sourceExcerpt}`));
      if(mode==="quiz"){
        children.push(para(e.kind==="sentence"?"中文翻译与句子结构：":"中文词义与语境用法：",{keepNext:true}));
        for(let n=0;n<(e.kind==="sentence"?4:2);n++)children.push(para("________________________________________________________________",{spacing:{after:180}}));
      }else answer(e);
      source(e);
    });
    if(mode==="quiz"){
      children.push(para("参考答案",{heading:HeadingLevel.HEADING_1,pageBreakBefore:true}));
      items.forEach((e,i)=>{children.push(para(`${i+1}  ${e.term}`,{heading:HeadingLevel.HEADING_2,keepNext:true}));answer(e);});
    }
    return new Document({creator:"YouTube Digest",title:mode==="quiz"?"英语词句自测":"英语词句学习讲义",
      styles:{default:{document:{run:{font:{ascii:"Arial",hAnsi:"Arial",eastAsia:"Songti SC",cs:"Arial"},size:22,color:"000000"},paragraph:{spacing:{line:300,after:140}}}},
        paragraphStyles:[{id:"Title",name:"Title",basedOn:"Normal",next:"Normal",run:{size:36,bold:true,color:"000000"},paragraph:{spacing:{after:240},keepNext:true}},
          {id:"Heading1",name:"Heading 1",basedOn:"Normal",next:"Normal",run:{size:30,bold:true,color:"000000"},paragraph:{spacing:{before:240,after:180},keepNext:true}},
          {id:"Heading2",name:"Heading 2",basedOn:"Normal",next:"Normal",run:{size:25,bold:true,color:"000000"},paragraph:{spacing:{before:220,after:120},keepNext:true}}]},
      sections:[{
        properties:{page:{size:{width:11906,height:16838},margin:{top:1134,bottom:1134,left:1134,right:1134}}},
        footers:{default:new Footer({children:[new Paragraph({
          alignment:AlignmentType.CENTER,
          children:[run("第 "),new TextRun({children:[PageNumber.CURRENT]}),run(" 页")]
        })]})},
        children
      }]
    });
  }
  async function toBlob(entries,options){return D.Packer.toBlob(buildDocument(entries,options));}
  return {buildDocument,toBlob};
})();
if(typeof module!=="undefined" && module.exports)module.exports=YTD_WORD;
