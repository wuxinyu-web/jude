"""Download public Bilibili audio and transcribe it locally; never translate captions."""
import argparse
import json
import math
import os
import signal
import threading
from pathlib import Path
import subprocess
import time
from server import read_json, write_json, VIDEO

from audio_download import MAX_SECONDS, MAX_BYTES, TranscriptionError, download_audio

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--folder', type=Path, required=True)
    parser.add_argument('--model', required=True)
    args = parser.parse_args()
    parent = os.getppid()
    def watch_parent():
        while True:
            time.sleep(2)
            if os.getppid() != parent:
                os.killpg(os.getpgrp(), signal.SIGTERM)
                return
    threading.Thread(target=watch_parent, daemon=True).start()
    folder = args.folder
    status = read_json(folder / 'status.json')
    def update(stage, message, progress=None):
        status.update(status=stage, message=message, updatedAt=time.time())
        if progress is not None:
            status['progress'] = progress
        write_json(folder / 'status.json', status)
    try:
        import imageio_ffmpeg
        import numpy as np
        import mlx_whisper
        video_id = status['videoId']
        if not VIDEO.fullmatch(video_id):
            raise ValueError('无效视频编号。')
        update('downloading', '正在读取当前视频的英文原声（不会上传音频）', 0)
        info, audio_path = download_audio(folder, video_id, update)
        update('decoding', '正在解码原声', 16)
        decoded = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-nostdin','-v','error','-i',str(audio_path),
            '-t',str(MAX_SECONDS+1),'-f','f32le','-ac','1','-ar','16000','pipe:1'], capture_output=True, check=True, timeout=360)
        audio = np.frombuffer(decoded.stdout, np.float32).copy()
        if len(audio) < 16000:
            raise ValueError('视频中没有足够的可识别音频。')
        duration = len(audio)/16000
        if duration > MAX_SECONDS:
            raise ValueError("本地转写暂限 180 分钟以内的视频。")
        segments = []
        # Thirty-second batches publish usable captions before the whole job finishes.
        # A small overlap supplies context; midpoint ownership deduplicates boundaries.
        chunk_seconds = 30
        for offset in range(0, math.ceil(duration), chunk_seconds):
            begin = max(0, offset-2)
            end = min(duration, offset+chunk_seconds+2)
            update('transcribing', f'正在转写英文原声：{offset//60} / {math.ceil(duration/60)} 分钟', 18+int(offset/duration*80))
            result = mlx_whisper.transcribe(audio[int(begin*16000):int(end*16000)], path_or_hf_repo=args.model,
                language='en', task='transcribe', temperature=0, condition_on_previous_text=False,
                word_timestamps=True, verbose=None)
            for item in result.get('segments', []):
                text = str(item.get('text','')).strip()
                start, finish = begin+float(item['start']), begin+float(item['end'])
                middle = (start+finish)/2
                if not text or not offset <= middle < min(duration, offset+chunk_seconds):
                    continue
                if item.get('no_speech_prob',0) > 0.6 and item.get('avg_logprob',0) < -1:
                    continue
                start = max(0, min(start, duration));finish=max(start,min(finish,duration))
                if finish > start:
                    segments.append({'text':text,'start':start,'duration':finish-start})
            segments.sort(key=lambda item:item['start'])
            if segments:
                partial = {'videoId':video_id,'transcript':list(segments),'language':'en','source':'local-asr',
                    'partial':True,'revision':offset//chunk_seconds+1,'processedUntil':min(duration,offset+chunk_seconds)}
                write_json(folder/'result.json',partial)
                # Existing running server versions already return status.json;
                # including the snapshot keeps progressive delivery compatible.
                status['result']=partial
                done=min(duration,offset+chunk_seconds)
                update('transcribing',f'边看边转写：已生成 {int(done)//60}:{int(done)%60:02d}，继续处理后续原声',18+int(done/duration*80))
        segments.sort(key=lambda item:item['start'])
        if not segments:
            raise ValueError('未识别到可用英文语音；原字幕未被替换。')
        result = {'videoId':video_id,'transcript':segments,'language':'en','source':'local-asr',
            'engine':'Whisper small.en','duration':duration,'createdAt':time.time(),
            'videoTitle':str(info.get('title','')),'notice':'英文原声自动转写，可能有识别误差，请结合音频核对。'}
        status.pop('result',None)
        write_json(folder/'result.json',result)
        update('completed', '英文原声转写完成，可以载入字幕。', 100)
    except Exception as error:
        # Do not send provider URLs, local paths or raw diagnostics to the browser.
        print(type(error).__name__, str(error), flush=True)
        if isinstance(error, TranscriptionError):
            status['errorCode'] = error.code
            update('failed', str(error))
        else:
            status['errorCode'] = 'TRANSCRIPTION_FAILED'
            update('failed', '原声解码或识别失败；请重试。若仍失败，请检查本地 worker.log。')
    finally:
        for path in folder.glob('audio*'):
            if path.is_file():
                path.unlink()

if __name__ == '__main__':
    main()
