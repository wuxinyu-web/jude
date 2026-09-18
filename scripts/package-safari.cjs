/* Stage only audited release files; no keys, profile data, or desktop ASR permission. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
function safariManifest(input){
  const m=JSON.parse(JSON.stringify(input));
  delete m.minimum_chrome_version;delete m.side_panel;
  if(m.options_ui)delete m.options_ui.open_in_tab;
  m.permissions=m.permissions.filter(p=>p!=='sidePanel');
  m.host_permissions=m.host_permissions.filter(p=>!p.startsWith('http://127.0.0.1'));
  m.host_permissions.push('https://m.youtube.com/*','https://m.bilibili.com/*');
  for(const script of m.content_scripts){
    const mobile=script.matches.map(p=>p.replace('://www.', '://m.'));
    script.matches.push(...mobile);
  }
  m.content_scripts.push({matches:['https://m.youtube.com/*','https://m.bilibili.com/*'],js:['lib/platform.js','safari/mobile-content.js'],run_at:'document_idle'});
  for(const resource of m.web_accessible_resources)resource.matches.push('https://m.youtube.com/*','https://m.bilibili.com/*');
  m.action.default_popup='safari/popup.html';
  return m;
}
if(require.main===module){
  for(const script of ['safari/popup.js','safari/mobile-content.js'])cp.execFileSync(process.execPath,['--check',path.join(root,script)]);
  const files=cp.execFileSync('bash',['scripts/check-release.sh','--print-files'],{cwd:root,encoding:'utf8'}).trim().split('\n');
  const m=safariManifest(JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')));
  const stage=path.join(root,'dist',`safari-web-extension-${m.version}`);
  fs.rmSync(stage,{recursive:true,force:true});
  fs.mkdirSync(stage,{recursive:true});
  for(const file of [...files,'safari/popup.html','safari/popup.css','safari/popup.js','safari/mobile-content.js','safari/mobile.css']){
    const dest=path.join(stage,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,file),dest);
  }
  fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify(m,null,2)+'\n');
  for(const file of ['sidepanel.html','options.html']){
    const dest=path.join(stage,file);fs.writeFileSync(dest,fs.readFileSync(dest,'utf8').replace('</head>','<link rel="stylesheet" href="safari/mobile.css"></head>'));
  }
  console.log(stage);
}
module.exports={safariManifest};
