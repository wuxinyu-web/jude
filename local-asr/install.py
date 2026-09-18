"""Install an isolated local-ASR runtime for Apple Silicon macOS or 64-bit Windows."""
import argparse
import hashlib
import json
import platform
from pathlib import Path
import re
import subprocess
import urllib.request
import venv

MLX_REVISION = '52a88bf6e98b114a210c21bb83e22d6e1505cb73'
MLX_WEIGHTS_SHA256 = '1bb29b030aca711a035f7a084a0eefac6251ecc2bdd356fa748858fbad082f5a'
MLX_MODEL_PATH = f'mlx-community/whisper-small.en-mlx/resolve/{MLX_REVISION}'
MLX_CONFIG = {'n_mels':80,'n_audio_ctx':1500,'n_audio_state':768,'n_audio_head':12,'n_audio_layer':12,'n_vocab':51864,'n_text_ctx':448,'n_text_state':768,'n_text_head':12,'n_text_layer':12,'model_type':'whisper'}

CT2_REVISION = '4138ac1f564d20fb698abba4511811dd53533e47'
CT2_MODEL_PATH = f'Systran/faster-whisper-small.en/resolve/{CT2_REVISION}'
CT2_FILES = {
    'config.json': (64 * 1024, None),
    'model.bin': (490 * 1024 * 1024, '62b2a45b05ee59acb4a5341b33ee35e041395d378d418a18acfe4c9e768ee37a'),
    'tokenizer.json': (3 * 1024 * 1024, None),
    'vocabulary.txt': (1024 * 1024, None),
}


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def platform_backend(system=None, machine=None):
    system = system or platform.system()
    machine = (machine or platform.machine()).lower()
    if system == 'Darwin' and machine == 'arm64':
        return 'mlx'
    if system == 'Windows' and machine in {'amd64', 'x86_64'}:
        return 'faster-whisper'
    raise SystemExit('当前本地转写支持 Apple Silicon Mac，以及 64 位 Intel/AMD Windows 10/11。')


def runtime_python(runtime, system=None):
    return runtime / ('Scripts/python.exe' if (system or platform.system()) == 'Windows' else 'bin/python')


def download_file(relative_path, target, maximum, expected_sha256=None):
    if target.is_file() and target.stat().st_size <= maximum:
        if expected_sha256 is None or digest(target) == expected_sha256:
            return
    partial = target.with_suffix(target.suffix + '.part')
    partial.unlink(missing_ok=True)
    errors = []
    for host in ('https://huggingface.co', 'https://hf-mirror.com'):
        try:
            with urllib.request.urlopen(f'{host}/{relative_path}', timeout=30) as response, partial.open('wb') as output:
                total = 0
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    total += len(block)
                    if total > maximum:
                        raise ValueError('模型文件大小超出预期。')
                    output.write(block)
                    if total and total % (50 * 1024 * 1024) == 0:
                        print(f'已下载 {target.name}: {total // 1024 // 1024} MB', flush=True)
            if not partial.stat().st_size:
                raise ValueError('模型文件为空。')
            if expected_sha256 and digest(partial) != expected_sha256:
                raise ValueError('模型校验不通过。')
            partial.replace(target)
            return
        except Exception as error:
            partial.unlink(missing_ok=True)
            errors.append(f'{type(error).__name__}: {error}')
    raise SystemExit(f'模型下载失败（{target.name}）。请检查网络后重新运行安装器。\n' + '\n'.join(errors))


def install_mlx_model(model):
    model.mkdir(parents=True, exist_ok=True)
    print('正在准备 Apple Silicon 本地英文语音模型（约 481 MB）…', flush=True)
    download_file(f'{MLX_MODEL_PATH}/weights.npz', model / 'weights.npz', 500 * 1024 * 1024, MLX_WEIGHTS_SHA256)
    (model / 'config.json').write_text(json.dumps(MLX_CONFIG), encoding='utf-8')


def install_ctranslate2_model(model):
    model.mkdir(parents=True, exist_ok=True)
    print('正在准备 Windows 本地英文语音模型（约 486 MB）…', flush=True)
    for name, (maximum, checksum) in CT2_FILES.items():
        download_file(f'{CT2_MODEL_PATH}/{name}', model / name, maximum, checksum)
    try:
        json.loads((model / 'config.json').read_text(encoding='utf-8'))
    except (OSError, ValueError) as error:
        raise SystemExit('模型配置校验失败，请删除 .local/model-windows 后重新安装。') from error


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--extension-id', required=True)
    parser.add_argument('--runtime', type=Path)
    parser.add_argument('--model', type=Path)
    args = parser.parse_args()
    engine = platform_backend()
    if not re.fullmatch('[a-p]{32}', args.extension_id):
        raise SystemExit('扩展 ID 无效。')
    root = Path(__file__).resolve().parent
    local = root / '.local'
    local.mkdir(exist_ok=True)
    runtime = (args.runtime or local / ('runtime-windows' if engine == 'faster-whisper' else 'runtime')).resolve()
    python = runtime_python(runtime)
    if not python.is_file():
        venv.create(runtime, with_pip=True)
    requirements = root / ('requirements-windows.lock' if engine == 'faster-whisper' else 'requirements.lock')
    subprocess.run([str(python), '-m', 'pip', 'install', '--disable-pip-version-check', '-r', str(requirements)], check=True)
    default_model = local / ('model-windows' if engine == 'faster-whisper' else 'model')
    model = (args.model or default_model).resolve()
    (install_ctranslate2_model if engine == 'faster-whisper' else install_mlx_model)(model)
    config_path = local / 'config.json'
    old = json.loads(config_path.read_text(encoding='utf-8')) if config_path.exists() else {}
    identities = list(dict.fromkeys(old.get('extensionIds', []) + [args.extension_id]))
    config_path.write_text(json.dumps({'extensionIds': identities, 'model': str(model), 'python': str(python), 'engine': engine}, indent=2), encoding='utf-8')
    if platform.system() != 'Windows':
        config_path.chmod(0o600)
    print('安装完成。启动 start.py（Windows 可双击 start-windows.cmd），再在插件里点击「转写英文原声」。', flush=True)


if __name__ == '__main__':
    main()
