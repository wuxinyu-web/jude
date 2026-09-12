"""Start the configured local service. Closing its terminal stops the service."""
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen
root=Path(__file__).resolve().parent
config_path=root/'.local/config.json'
if not config_path.is_file():
    raise SystemExit('尚未配置本地原声转写，请先运行安装器。')
config=json.loads(config_path.read_text())
# Double-clicking the launcher again should not start a competing service.
try:
    request=Request('http://127.0.0.1:8766/health',headers={'X-Study-Extension':config['extensionIds'][0]})
    with urlopen(request,timeout=2) as response:
        health=json.load(response)
    if health.get('ready') and health.get('engine')=='Whisper 本地英文转写':
        print('本地原声转写服务已经运行。请返回视频侧栏点击「转写英文原声」。')
        raise SystemExit(0)
except (OSError, ValueError):
    pass
os.execv(config['python'],[config['python'],str(root/'server.py'),'--config',str(config_path)])
