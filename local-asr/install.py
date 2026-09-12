"""Install an isolated Apple Silicon ASR runtime and checksum-pinned model."""
import argparse
import hashlib
import json
import platform
from pathlib import Path
import re
import subprocess
import sys
import urllib.request
import venv

REVISION = '52a88bf6e98b114a210c21bb83e22d6e1505cb73'
WEIGHTS_SHA256 = '1bb29b030aca711a035f7a084a0eefac6251ecc2bdd356fa748858fbad082f5a'
MODEL_PATH = f'mlx-community/whisper-small.en-mlx/resolve/{REVISION}'
CONFIG = {'n_mels':80,'n_audio_ctx':1500,'n_audio_state':768,'n_audio_head':12,'n_audio_layer':12,'n_vocab':51864,'n_text_ctx':448,'n_text_state':768,'n_text_head':12,'n_text_layer':12,'model_type':'whisper'}

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--extension-id',required=True)
    parser.add_argument('--runtime',type=Path)
    parser.add_argument('--model',type=Path)
    args=parser.parse_args()
    if platform.system()!='Darwin' or platform.machine()!='arm64':
        raise SystemExit('当前本地转写安装器支持 Apple Silicon Mac。')
    if not re.fullmatch('[a-p]{32}',args.extension_id):raise SystemExit('扩展 ID 无效。')
    root=Path(__file__).resolve().parent
    local=root/'.local';local.mkdir(exist_ok=True)
    runtime=(args.runtime or local/'runtime').resolve()
    if not (runtime/'bin/python').is_file():venv.create(runtime,with_pip=True)
    python=runtime/'bin/python'
    subprocess.run([str(python),'-m','pip','install','-r',str(root/'requirements.lock')],check=True)
    model=(args.model or local/'model').resolve();model.mkdir(parents=True,exist_ok=True)
    weights=model/'weights.npz'
    if not weights.is_file() or digest(weights)!=WEIGHTS_SHA256:
        for host in ['https://huggingface.co','https://hf-mirror.com']:
            try:
                print('正在下载本地英文语音模型（约 481 MB）…',flush=True)
                with urllib.request.urlopen(f'{host}/{MODEL_PATH}/weights.npz',timeout=20) as response, weights.with_suffix('.part').open('wb') as target:
                    total=0
                    while True:
                        block=response.read(1024*1024)
                        if not block:break
                        total+=len(block)
                        if total>500*1024*1024:raise ValueError('模型大小超出预期。')
                        target.write(block)
                        if total%(50*1024*1024)==0:print(f'已下载 {total//1024//1024} MB',flush=True)
                weights.with_suffix('.part').replace(weights)
                if digest(weights)!=WEIGHTS_SHA256:raise ValueError('模型校验不通过。')
                break
            except Exception as error:
                print(type(error).__name__,str(error),flush=True)
        else:raise SystemExit('模型下载失败。请检查网络后重新运行安装器。')
    (model/'config.json').write_text(json.dumps(CONFIG))
    config_path=local/'config.json'
    old=json.loads(config_path.read_text()) if config_path.exists() else {}
    identities=list(dict.fromkeys(old.get('extensionIds',[])+[args.extension_id]))
    config_path.write_text(json.dumps({'extensionIds':identities,'model':str(model),'python':str(python)},indent=2))
    config_path.chmod(0o600)
    print('安装完成。运行 local-asr/start.py 启动服务，再在插件里点击「转写英文原声」。',flush=True)

if __name__=='__main__':main()
