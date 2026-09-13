"""Bounded public-audio download with Bilibili-provided CDN fallbacks."""
from pathlib import Path
from urllib.parse import urlparse

MAX_SECONDS = 180 * 60
MAX_BYTES = 300 * 1024 * 1024

class TranscriptionError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def validate_media(info, video_id, segment=None):
    episode = video_id.startswith('bili_ep')
    expected = video_id[7:] if episode else (video_id if '_p' in video_id else video_id + '_p1')
    actual = (info or {}).get('id', '')
    if not episode and actual and '_p' not in actual:
        actual += '_p1'
    if not info or info.get('entries') is not None or actual != expected:
        raise TranscriptionError('VIDEO_MISMATCH', '未能读取指定分 P 的原声；请重新打开该分 P 后重试。')
    if info.get('is_live'):
        raise TranscriptionError('LIVE_UNSUPPORTED', '暂不支持直播原声转写。')
    seconds = info.get('duration') or 0
    if segment is not None:
        from server import validate_range
        validate_range(segment)
        if not 0 < seconds <= 86400 or segment['start'] >= seconds:
            raise TranscriptionError('RANGE_INVALID', '片段超出视频范围，或视频超过 24 小时。')
        return
    if seconds > MAX_SECONDS:
        minutes = round(seconds / 60)
        raise TranscriptionError('DURATION_LIMIT', f'当前分 P 长达 {minutes//60} 小时 {minutes%60} 分钟，超过单次 3 小时的转写上限。请切换到单集或较短的分 P；重试整段不会解决此限制。')


def audio_candidates(formats):
    candidates, seen = [], set()
    for fmt in reversed(formats):
        if fmt.get('vcodec') != 'none' or fmt.get('ext') != 'm4a':
            continue
        for url in [fmt.get('url'), *fmt.get('backup_urls', [])]:
            if not isinstance(url, str) or url in seen:
                continue
            parsed = urlparse(url)
            host = parsed.hostname or ''
            if parsed.scheme not in ('https', 'http') or not any(host.endswith('.'+d) for d in ('bilivideo.com', 'bilivideo.cn', 'akamaized.net')):
                continue
            seen.add(url)
            candidates.append({**fmt, 'url':url})
    # Audio quality order is retained within each tier. Never invent CDN URLs.
    candidates.sort(key=lambda f: '.mcdn.' in urlparse(f['url']).hostname)
    return candidates[:6]


def extractor_class():
    from yt_dlp.extractor.bilibili import BiliBiliIE
    class StudyBiliIE(BiliBiliIE):
        @classmethod
        def ie_key(cls):
            return BiliBiliIE.ie_key()
        def extract_formats(self, play_info):
            formats = super().extract_formats(play_info)
            dash = (play_info or {}).get('dash') or {}
            audios = list(dash.get('audio') or []) + list((dash.get('dolby') or {}).get('audio') or [])
            for fmt in formats:
                for audio in audios:
                    if fmt.get('vcodec') == 'none' and fmt.get('url') == (audio.get('baseUrl') or audio.get('base_url') or audio.get('url')):
                        fmt['backup_urls'] = audio.get('backupUrl') or audio.get('backup_url') or []
            return formats
    return StudyBiliIE


def download_audio(folder, video_id, update, downloader_factory=None, segment=None):
    from yt_dlp import YoutubeDL
    from yt_dlp.utils import DownloadError
    bvid, _, part = video_id.partition('_p')
    episode = video_id.startswith('bili_ep')
    url = f'https://www.bilibili.com/bangumi/play/ep{video_id[7:]}' if episode else f'https://www.bilibili.com/video/{bvid}/?p={part or 1}'
    def progress(data):
        downloaded = data.get('downloaded_bytes', 0)
        if downloaded > MAX_BYTES:
            raise TranscriptionError('SIZE_LIMIT', '音频超过单次 300 MB 上限，请选择较短的分 P。')
        total = data.get('total_bytes') or data.get('total_bytes_estimate') or 0
        update('downloading', '正在下载原声音频到本机', min(15, round(downloaded / total * 15)) if total else 0)
    options = dict(format='bestaudio[ext=m4a]', outtmpl=str(folder/'audio.%(ext)s'), noplaylist=True,
        quiet=True, noprogress=True, no_warnings=True, socket_timeout=12, retries=0,
        fragment_retries=0, max_filesize=MAX_BYTES, progress_hooks=[progress], cachedir=False)
    with (downloader_factory or YoutubeDL)(options) as ydl:
        ydl.add_info_extractor(extractor_class()())
        try:
            info = ydl.extract_info(url, download=False, process=False, ie_key='BiliBiliBangumi' if episode else 'BiliBili')
        except DownloadError as error:
            raise TranscriptionError('MEDIA_UNAVAILABLE', '无法获取这段原声：可能需要会员、登录或地区授权。本地服务目前仅能读取公开音频；可换一个公开可播放的视频后重试。') from error
        validate_media(info, video_id, segment)
        candidates = audio_candidates(info.get('formats') or [])
        if not candidates:
            raise TranscriptionError('NO_AUDIO', '这个分 P 没有可公开读取的独立音轨，暂时无法转写。')
        failures = []
        for index, fmt in enumerate(candidates):
            if not segment and (fmt.get('filesize') or 0) > MAX_BYTES:
                continue
            update('downloading', f'正在连接原声下载节点 {index+1}/{len(candidates)}', 0)
            # A retry must not append a different CDN/quality to an old partial file.
            for path in folder.glob('audio*'):
                if path.is_file():
                    path.unlink()
            try:
                if segment:
                    return info, download_segment(folder, fmt['url'], segment, info['duration'])
                result = ydl.process_ie_result({**info, 'formats':[fmt]}, download=True)
                path = Path(ydl.prepare_filename(result))
                if path.is_file() and 0 < path.stat().st_size <= MAX_BYTES:
                    return info, path
                failures.append('empty-or-limited')
            except (DownloadError, SegmentDownloadError) as error:
                failures.append(type(error).__name__)
        if not failures:
            raise TranscriptionError('SIZE_LIMIT', '音频超过单次 300 MB 上限，请选择较短的分 P。')
        raise TranscriptionError('AUDIO_DOWNLOAD', '原声下载失败，已尝试可用的备用节点。请稍后重试或切换网络；当前未进入语音识别阶段。')


class SegmentDownloadError(Exception):
    pass


def download_segment(folder, url, segment, duration):
    import imageio_ffmpeg
    import subprocess
    from yt_dlp.utils import std_headers
    end = min(segment['end'], duration)
    path = folder/'audio.wav'
    # Input-side seeking lets the HTTP demuxer read only the selected time range.
    # Decode to PCM so the returned sample zero corresponds to the requested start.
    command = [imageio_ffmpeg.get_ffmpeg_exe(), '-nostdin', '-y', '-v', 'error',
        '-rw_timeout', '12000000', '-user_agent', std_headers['User-Agent'], '-headers', 'Referer: https://www.bilibili.com/\r\n',
        '-ss', str(segment['start']), '-i', url, '-t', str(end-segment['start']),
        '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-fs', str(MAX_BYTES), str(path)]
    try:
        subprocess.run(command, capture_output=True, check=True, timeout=180)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        raise SegmentDownloadError('片段音频节点读取失败') from error
    if not path.is_file() or not 44 < path.stat().st_size < MAX_BYTES:
        raise SegmentDownloadError('片段音频为空或过大')
    return path
