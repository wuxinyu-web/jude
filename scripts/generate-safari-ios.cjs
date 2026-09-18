// Local, unsigned Xcode project; never uploads or selects a signing identity.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),version=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')).version;
cp.execFileSync(process.execPath,[path.join(__dirname,'package-safari.cjs')],{cwd:root,stdio:'inherit'});
const destination=path.join(root,'dist',`safari-ios-${version}`);
if(fs.existsSync(destination))throw new Error('工程目录已存在。请保留其中的签名设置，或移动该目录后再重新生成：'+destination);
cp.execFileSync('xcrun',['safari-web-extension-converter',path.join(root,'dist',`safari-web-extension-${version}`),'--project-location',destination,'--app-name','Jude','--bundle-identifier','app.jude.safari','--ios-only','--swift','--copy-resources','--no-open','--no-prompt'],{stdio:'inherit'});
const project=path.join(destination,'Jude','Jude.xcodeproj','project.pbxproj');
fs.writeFileSync(project,fs.readFileSync(project,'utf8').replace(/IPHONEOS_DEPLOYMENT_TARGET = [\d.]+;/g,'IPHONEOS_DEPLOYMENT_TARGET = 18.0;'));
const welcome=path.join(destination,'Jude','Jude','Resources','Base.lproj','Main.html');
fs.copyFileSync(path.join(root,'safari','welcome.html'),welcome);
const controller=path.join(destination,'Jude','Jude','ViewController.swift');
fs.writeFileSync(controller,fs.readFileSync(controller,'utf8').replace('isScrollEnabled = false','isScrollEnabled = true'));
fs.copyFileSync(path.join(root,'safari','README.md'),path.join(destination,'安装说明.md'));
console.log('Unsigned iOS project: '+path.dirname(project));
