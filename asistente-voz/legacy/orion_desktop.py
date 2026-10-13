#!/usr/bin/env python3
"""
O.R.I.Ó.N. - Asistente Inteligente con Machine Learning y Control del Sistema.

Características:
  - Saludo vocal inmediato al ejecutarse (ElevenLabs con caché o pyttsx3 local).
  - Ejecución de acciones de inicio (música en Spotify, Claude en Chrome, Binance/Tasaradar, Cursor IDE).
  - Procesamiento de Lenguaje Natural (NLP) con Machine Learning (Scikit-Learn).
  - Clasificación de intenciones en tiempo real para comandos en español e inglés.
  - Reconocimiento de voz por micrófono (SpeechRecognition).
  - Monitoreo de hardware y recursos del sistema (CPU, RAM, Disco con psutil).
  - Búsquedas inteligentes en la web, consulta de hora y fecha, chistes tecnológicos.
  - Conexión opcional con LLMs (Google Gemini / OpenAI) si se configuran claves en .env.
"""

from __future__ import annotations

import datetime
import hashlib
import logging
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import wave
import webbrowser
from pathlib import Path

import numpy as np
import sounddevice as sd
from dotenv import load_dotenv

# Cargar variables de entorno desde .env
load_dotenv(Path(__file__).resolve().parent / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("orion")

# --- Configuración general ----------------------------------------------------
SAMPLE_RATE = int(
    os.environ.get("ORION_SAMPLE_RATE")
    or os.environ.get("JARVIS_SAMPLE_RATE")
    or 44100
)
BLOCK_MS = 40
CHANNELS = 1

# ¿Ejecutar las herramientas y música al arrancar? (False por defecto para no abrir ventanas sin pedirlo)
RUN_STARTUP_ACTIONS_ON_LAUNCH = (
    os.environ.get("RUN_STARTUP_ACTIONS_ON_LAUNCH", "false").strip().lower() in ("true", "1", "yes")
)

# Spotify / YouTube URL
SONG_URI = os.environ.get(
    "SONG_URI",
    "https://open.spotify.com/track/39shmbIHICJ2Wxnk1fPSdz?si=2900c75c2e2d4b82",
)

# Cursor IDE
FOCUS_EXISTING_CURSOR_ON_DOUBLE_CLAP = True
OPEN_NEW_CURSOR_ON_DOUBLE_CLAP = False
CURSOR_OPEN_FULLSCREEN = True

# Google Chrome y monitores
OPEN_CLAUDE_CODE_IN_CHROME = True
OPEN_BINANCE_BTC_IN_CHROME = True
OPEN_CHROME_FULLSCREEN = True
CHROME_SEPARATE_SITE_PROFILES = False
CLAUDE_CHROME_MONITOR = int(os.environ.get("CLAUDE_CHROME_MONITOR", "1"))
BINANCE_CHROME_MONITOR = int(os.environ.get("BINANCE_CHROME_MONITOR", "3"))

# Saludo de bienvenida
ORION_WELCOME_ENABLED = True
DEFAULT_WELCOME_PHRASE = (
    "Bienvenido señor. Orión en línea, sistemas listos y a su entera disposición."
)
ORION_WELCOME_PHRASE = (
    os.environ.get("ORION_WELCOME_PHRASE")
    or os.environ.get("orion_welcome_phrase")
    or os.environ.get("JARVIS_WELCOME_PHRASE")
    or os.environ.get("jarvis_welcome_phrase")
    or DEFAULT_WELCOME_PHRASE
)
ORION_AFTER_SONG_DELAY_S = float(
    os.environ.get("ORION_AFTER_SONG_DELAY_S")
    or os.environ.get("JARVIS_AFTER_SONG_DELAY_S", "1.0")
)
ORION_WELCOME_CACHE_ENABLED = True

# Retrocompatibilidad
JARVIS_WELCOME_ENABLED = ORION_WELCOME_ENABLED
JARVIS_WELCOME_PHRASE = ORION_WELCOME_PHRASE
JARVIS_AFTER_SONG_DELAY_S = ORION_AFTER_SONG_DELAY_S
JARVIS_WELCOME_CACHE_ENABLED = ORION_WELCOME_CACHE_ENABLED



# DISPOSITIVOS DE AUDIO Y ENTRADA


def block_samples() -> int:
    n = int(SAMPLE_RATE * BLOCK_MS / 1000)
    return max(n, 1)


def rms_mono(block: np.ndarray) -> float:
    if block.ndim > 1:
        block = np.mean(block.astype(np.float64), axis=1)
    else:
        block = block.astype(np.float64)
    if block.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(block**2)))


def _input_devices() -> list[tuple[int, dict]]:
    return [
        (i, dev)
        for i, dev in enumerate(sd.query_devices())
        if dev["max_input_channels"] >= 1
    ]


def _resolve_input_device_index(spec: str) -> int:
    spec = spec.strip()
    if spec.isdigit():
        idx = int(spec)
        sd.query_devices(idx)
        return idx
    needle = spec.lower()
    for idx, dev in _input_devices():
        if needle in dev["name"].lower():
            return idx
    raise ValueError(f"No hay dispositivo de entrada que coincida con {spec!r}")


def _probe_input_max_rms(device: int, blocksize: int) -> float | None:
    try:
        with sd.InputStream(
            device=device,
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype="float32",
            blocksize=blocksize,
        ) as stream:
            peak = 0.0
            deadline = time.monotonic() + 0.3
            while time.monotonic() < deadline:
                data, _ = stream.read(blocksize)
                peak = max(peak, rms_mono(data))
            return peak
    except Exception:
        return None


def _choose_input_device(blocksize: int) -> int | None:
    override = (
        os.environ.get("ORION_INPUT_DEVICE")
        or os.environ.get("JARVIS_INPUT_DEVICE")
        or ""
    ).strip()
    if override:
        try:
            return _resolve_input_device_index(override)
        except Exception as e:
            log.warning("Dispositivo configurado no válido: %s. Usando predeterminado.", e)

    default = sd.default.device[0]
    if default is not None and default >= 0:
        return default

    inputs = _input_devices()
    if inputs:
        return inputs[0][0]
    return None



# SÍNTESIS DE VOZ (ELEVENLABS + FALLBACK PYTTSX3)


def elevenlabs_env_config() -> tuple[str, str, str, int]:
    voice = (
        os.environ.get("ELEVENLABS_VOICE_ID")
        or os.environ.get("elevenlabs_voice_id")
        or ""
    ).strip()
    model = (
        os.environ.get("ELEVENLABS_MODEL_ID")
        or os.environ.get("elevenlabs_model_id")
        or "eleven_multilingual_v2"
    ).strip()
    fmt = (
        os.environ.get("ELEVENLABS_OUTPUT_FORMAT")
        or os.environ.get("elevenlabs_output_format")
        or "pcm_24000"
    ).strip()
    rate = 24000
    if fmt.startswith("pcm_"):
        try:
            rate = int(fmt.split("_", maxsplit=1)[1])
        except (ValueError, IndexError):
            pass
    return voice, model, fmt, rate


def _welcome_cache_dir() -> Path:
    base = Path(__file__).resolve().parent
    override = (
        os.environ.get("ORION_WELCOME_CACHE_DIR")
        or os.environ.get("JARVIS_WELCOME_CACHE_DIR")
        or ""
    ).strip()
    if override:
        return Path(override).expanduser().resolve()
    return base / ".cache" / "orion_welcome"


def _welcome_cache_path(
    text: str, voice_id: str, model_id: str, output_format: str
) -> Path:
    key = f"{text}|{voice_id}|{model_id}|{output_format}".encode()
    digest = hashlib.sha256(key).hexdigest()[:24]
    return _welcome_cache_dir() / f"{digest}.wav"


# Retrocompatibilidad
_jarvis_welcome_cache_dir = _welcome_cache_dir
_jarvis_welcome_cache_path = _welcome_cache_path


def _play_pcm_wav_file(path: Path) -> bool:
    try:
        with wave.open(str(path), "rb") as wf:
            ch = wf.getnchannels()
            sw = wf.getsampwidth()
            rate = wf.getframerate()
            if ch != 1 or sw != 2:
                return False
            raw = wf.readframes(wf.getnframes())
    except Exception:
        return False
    if not raw:
        return False
    pcm_i16 = np.frombuffer(raw, dtype=np.int16)
    pcm_f = pcm_i16.astype(np.float32) / 32768.0
    try:
        sd.play(pcm_f, rate)
        sd.wait()
        return True
    except Exception as e:
        log.warning("No se pudo reproducir audio caché: %s", e)
        return False


def _save_pcm_wav_file(path: Path, pcm_bytes: bytes, sample_rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        with wave.open(str(tmp), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(pcm_bytes)
        tmp.replace(path)
    except Exception:
        if tmp.is_file():
            tmp.unlink(missing_ok=True)


def _speak_pyttsx3(text: str) -> bool:
    """Síntesis de voz local offline mediante pyttsx3."""
    try:
        import pyttsx3

        engine = pyttsx3.init()
        try:
            voices = engine.getProperty("voices")
            for v in voices:
                v_str = (getattr(v, "name", "") + " " + getattr(v, "id", "")).lower()
                if any(tag in v_str for tag in ["spanish", "español", "helena", "sabina", "es-"]):
                    engine.setProperty("voice", v.id)
                    break
        except Exception:
            pass
        engine.setProperty("rate", 175)
        engine.say(text)
        engine.runAndWait()
        engine.stop()
        return True
    except Exception as e:
        log.warning("pyttsx3 no disponible: %s", e)
        return False


def orion_speak(text: str, wait: bool = True) -> None:
    """Vocaliza la respuesta con ElevenLabs (con caché local) o pyttsx3."""
    if not text or not text.strip():
        return
    text = text.strip()
    log.info("🤖 ORIÓN: %s", text)

    def _do_speak():
        # 1. Intentar ElevenLabs
        api_key = (
            os.environ.get("ELEVENLABS_API_KEY")
            or os.environ.get("elevenlabs_api_key")
            or ""
        ).strip()
        vid, model_id, output_format, pcm_rate = elevenlabs_env_config()

        elevenlabs_success = False
        if api_key and vid:
            cache_path = _welcome_cache_path(text, vid, model_id, output_format)
            if ORION_WELCOME_CACHE_ENABLED and cache_path.is_file():
                if _play_pcm_wav_file(cache_path):
                    return

            try:
                from elevenlabs.client import ElevenLabs

                client = ElevenLabs(api_key=api_key)
                chunks = client.text_to_speech.convert(
                    voice_id=vid,
                    text=text,
                    model_id=model_id,
                    output_format=output_format,
                )
                raw = b"".join(chunks)
                if raw:
                    if ORION_WELCOME_CACHE_ENABLED:
                        try:
                            _save_pcm_wav_file(cache_path, raw, pcm_rate)
                        except Exception:
                            pass
                    pcm_i16 = np.frombuffer(raw, dtype=np.int16)
                    pcm_f = pcm_i16.astype(np.float32) / 32768.0
                    sd.play(pcm_f, pcm_rate)
                    sd.wait()
                    elevenlabs_success = True
            except Exception as e:
                log.info("ElevenLabs no respondió (%s); usando síntesis local pyttsx3.", e)

        # 2. Fallback local si ElevenLabs no está configurado o falla
        if not elevenlabs_success:
            _speak_pyttsx3(text)

    if wait:
        _do_speak()
    else:
        threading.Thread(target=_do_speak, daemon=True).start()


jarvis_speak = orion_speak


def say_orion_welcome() -> None:
    """Pronuncia el saludo de bienvenida de Orión."""
    if ORION_WELCOME_ENABLED and ORION_WELCOME_PHRASE.strip():
        orion_speak(ORION_WELCOME_PHRASE, wait=True)


say_jarvis_welcome = say_orion_welcome



# APLICACIONES EXTERNAS (SPOTIFY, CHROME, CURSOR)


def play_song(uri: str) -> None:
    u = uri.strip()
    if not u:
        return
    try:
        log.info("Reproduciendo música: %s", u)
        if sys.platform == "win32":
            os.startfile(u)
        else:
            webbrowser.open(u)
    except Exception as e:
        log.warning("No se pudo reproducir SONG_URI: %s", e)


def _chrome_executable() -> str | None:
    if sys.platform == "win32":
        for base in (
            os.environ.get("ProgramFiles", r"C:\Program Files"),
            os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
            os.environ.get("LOCALAPPDATA", ""),
        ):
            if not base:
                continue
            p = os.path.join(base, "Google", "Chrome", "Application", "chrome.exe")
            if os.path.isfile(p):
                return p
    return shutil.which("google-chrome") or shutil.which("chrome")


def _win32_sorted_monitor_rects() -> list[tuple[int, int, int, int]]:
    if sys.platform != "win32":
        return []
    import ctypes
    from ctypes import wintypes

    class RECT(ctypes.Structure):
        _fields_ = [
            ("left", wintypes.LONG),
            ("top", wintypes.LONG),
            ("right", wintypes.LONG),
            ("bottom", wintypes.LONG),
        ]

    collected: list[tuple[int, int, int, int]] = []

    @ctypes.WINFUNCTYPE(
        wintypes.BOOL,
        wintypes.HMONITOR,
        wintypes.HDC,
        ctypes.POINTER(RECT),
        wintypes.LPARAM,
    )
    def _cb(_hm, _hdc, lprc, _lp):
        r = lprc.contents
        collected.append((int(r.left), int(r.top), int(r.right), int(r.bottom)))
        return True

    try:
        ctypes.windll.user32.EnumDisplayMonitors(None, None, _cb, 0)
        collected.sort(key=lambda t: (t[0], t[1]))
    except Exception:
        pass
    return collected


def _chrome_monitor_bounds(one_based_index: int) -> tuple[int, int, int, int]:
    rects = _win32_sorted_monitor_rects()
    if not rects:
        return (0, 0, 1920, 1080)
    idx = max(0, min(one_based_index - 1, len(rects) - 1))
    return rects[idx]


def _chrome_top_level_browser_hwnds_win32() -> set[int]:
    if sys.platform != "win32":
        return set()
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    GW_OWNER = 4
    GWL_EXSTYLE = -20
    WS_EX_TOOLWINDOW = 0x00000080
    found: set[int] = set()

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def _enum(hwnd: wintypes.HWND, _lp: wintypes.LPARAM) -> bool:
        if user32.GetWindow(hwnd, GW_OWNER):
            return True
        if user32.GetWindowLongW(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW:
            return True
        if not user32.IsWindowVisible(hwnd) and not user32.IsIconic(hwnd):
            return True
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value == 0:
            return True
        hproc = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
        if not hproc:
            return True
        try:
            buf = ctypes.create_unicode_buffer(4096)
            sz = wintypes.DWORD(len(buf))
            if not kernel32.QueryFullProcessImageNameW(hproc, 0, buf, ctypes.byref(sz)):
                return True
            exe_path = buf.value
        finally:
            kernel32.CloseHandle(hproc)
        if os.path.basename(exe_path).lower() != "chrome.exe":
            return True
        found.add(int(hwnd))
        return True

    try:
        user32.EnumWindows(_enum, 0)
    except Exception:
        pass
    return found


def _wait_new_chrome_hwnd_win32(before: set[int], timeout: float = 8.0) -> int | None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        time.sleep(0.15)
        now = _chrome_top_level_browser_hwnds_win32()
        new = now - before
        if new:
            return list(new)[0]
    return None


def _chrome_snap_window_to_monitor_win32(hwnd: int, one_based_monitor: int) -> None:
    if sys.platform != "win32":
        return
    import ctypes
    user32 = ctypes.windll.user32
    ml, mt, mr, mb = _chrome_monitor_bounds(one_based_monitor)
    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    user32.SetWindowPos(hwnd, 0, ml, mt, mr - ml, mb - mt, 0x0040)
    user32.ShowWindow(hwnd, 3)  # SW_MAXIMIZE


def _open_url_in_chrome(url: str, monitor: int = 1) -> None:
    u = url.strip()
    if not u:
        return
    chrome = _chrome_executable()
    try:
        if chrome:
            args = [chrome, "--new-window", u]
            popen_kw: dict = {
                "args": args,
                "stdin": subprocess.DEVNULL,
                "stdout": subprocess.DEVNULL,
                "stderr": subprocess.DEVNULL,
            }
            if sys.platform == "win32":
                popen_kw["creationflags"] = subprocess.CREATE_NO_WINDOW
                before = _chrome_top_level_browser_hwnds_win32()
                subprocess.Popen(**popen_kw)
                hwnd = _wait_new_chrome_hwnd_win32(before, 5.0)
                if hwnd is not None:
                    _chrome_snap_window_to_monitor_win32(hwnd, monitor)
            else:
                subprocess.Popen(**popen_kw)
        else:
            webbrowser.open(u)
    except Exception as e:
        log.warning("No se pudo abrir %s: %s", u, e)


def open_claude_in_chrome() -> None:
    url = (os.environ.get("CLAUDE_CODE_URL") or "https://claude.ai/new").strip()
    log.info("Abriendo Claude en monitor %d: %s", CLAUDE_CHROME_MONITOR, url)
    _open_url_in_chrome(url, CLAUDE_CHROME_MONITOR)


def open_binance_btc_in_chrome() -> None:
    url = (
        os.environ.get("TASARADAR_URL")
        or os.environ.get("BINANCE_BTC_URL")
        or "https://www.binance.com/en/trade/BTC_USDT"
    ).strip()
    log.info("Abriendo mercado en monitor %d: %s", BINANCE_CHROME_MONITOR, url)
    _open_url_in_chrome(url, BINANCE_CHROME_MONITOR)


def _cursor_executable() -> str | None:
    cmd = shutil.which("cursor") or shutil.which("cursor.cmd")
    if cmd:
        return cmd
    if sys.platform == "win32":
        local = os.environ.get("LOCALAPPDATA", "")
        if local:
            p = os.path.join(local, "Programs", "cursor", "Cursor.exe")
            if os.path.isfile(p):
                return p
    return None


def _cursor_largest_main_hwnd_win32() -> int | None:
    if sys.platform != "win32":
        return None
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    candidates: list[tuple[int, int]] = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def _enum(hwnd: wintypes.HWND, _lp: wintypes.LPARAM) -> bool:
        if not user32.IsWindowVisible(hwnd):
            return True
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value == 0:
            return True
        hproc = kernel32.OpenProcess(0x1000, False, pid.value)
        if not hproc:
            return True
        try:
            buf = ctypes.create_unicode_buffer(4096)
            sz = wintypes.DWORD(len(buf))
            if not kernel32.QueryFullProcessImageNameW(hproc, 0, buf, ctypes.byref(sz)):
                return True
            exe = os.path.basename(buf.value).lower()
        finally:
            kernel32.CloseHandle(hproc)
        if exe != "cursor.exe":
            return True
        r = wintypes.RECT()
        if user32.GetWindowRect(hwnd, ctypes.byref(r)):
            w, h = r.right - r.left, r.bottom - r.top
            if w > 200 and h > 200:
                candidates.append((w * h, int(hwnd)))
        return True

    try:
        user32.EnumWindows(_enum, 0)
    except Exception:
        pass
    if candidates:
        return max(candidates, key=lambda t: t[0])[1]
    return None


def open_cursor_window() -> None:
    log.info("Enfocando o iniciando Cursor IDE...")
    if sys.platform == "win32":
        import ctypes
        hwnd = _cursor_largest_main_hwnd_win32()
        if hwnd is not None:
            user32 = ctypes.windll.user32
            user32.ShowWindow(hwnd, 9)
            user32.SetForegroundWindow(hwnd)
            return
    exe = _cursor_executable()
    if exe:
        try:
            popen_kw: dict = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
            if sys.platform == "win32":
                popen_kw["creationflags"] = subprocess.CREATE_NO_WINDOW
            subprocess.Popen([exe], **popen_kw)
        except Exception as e:
            log.warning("No se pudo iniciar Cursor: %s", e)


def run_startup_actions() -> None:
    """Ejecuta las aplicaciones del ecosistema configurado."""
    log.info("🚀 Ejecutando acciones automáticas de inicio...")
    if SONG_URI.strip():
        play_song(SONG_URI)
    if OPEN_CLAUDE_CODE_IN_CHROME:
        open_claude_in_chrome()
    if OPEN_BINANCE_BTC_IN_CHROME:
        open_binance_btc_in_chrome()
    open_cursor_window()

# Retrocompatibilidad
run_double_clap_actions = run_startup_actions



# RECONOCIMIENTO DE VOZ (SPEECH-TO-TEXT CON MACHINE LEARNING)


def listen_microphone(
    device_index: int | None = None,
    timeout: float = 4.0,
    phrase_time_limit: float = 8.0,
    recognizer: Any = None,
    microphone: Any = None,
    show_listening_prompt: bool = True,
) -> str | None:
    """Captura y transcribe la voz del usuario a través del micrófono."""
    try:
        import speech_recognition as sr
    except ImportError:
        log.warning("SpeechRecognition no instalado.")
        return None

    rec = recognizer
    if rec is None:
        rec = sr.Recognizer()
        rec.dynamic_energy_threshold = True
        rec.pause_threshold = 0.8

    try:
        mic = microphone or sr.Microphone(device_index=device_index)
        with mic as source:
            if show_listening_prompt:
                print("\r🎙️ [ORIÓN ESCUCHANDO...] Hable en cualquier momento (o toque una tecla para escribir)...", end="", flush=True)
            audio = rec.listen(source, timeout=timeout, phrase_time_limit=phrase_time_limit)

        print("\n⚡ [PROCESANDO VOZ...]")
        # 1. Intentar reconocimiento en español
        try:
            text = rec.recognize_google(audio, language="es-ES")
            return text
        except sr.UnknownValueError:
            # 2. Intentar reconocimiento en inglés
            try:
                text = rec.recognize_google(audio, language="en-US")
                return text
            except sr.UnknownValueError:
                return None
    except sr.WaitTimeoutError:
        # Silencio ambiental normal durante el ciclo de escucha
        return None
    except Exception as e:
        log.warning("Error al capturar audio del micrófono: %s", e)
        return None



# CEREBRO DE MACHINE LEARNING: CLASIFICADOR DE INTENCIONES NLP (SCIKIT-LEARN)


class OrionMLBrain:
    """
    Cerebro de Procesamiento de Lenguaje Natural impulsado por Machine Learning.
    Utiliza extracción de características TF-IDF y regresión logística multinomial
    para clasificar intenciones de usuario en tiempo real con probabilidades calibradas.
    """

    CHISTES = [
        "¿Por qué los programadores confunden Halloween con Navidad? Porque OCT 31 es igual a DEC 25.",
        "Hay 10 tipos de personas en el mundo: las que entienden binario y las que no.",
        "Un optimista ve el vaso medio lleno. Un pesimista lo ve medio vacío. Un programador ve que el vaso tiene el doble de capacidad requerida.",
        "El hardware es lo que puedes golpear cuando falla el software.",
        "Estaba pensando en hacer una broma sobre UDP... pero no sé si la recibirías.",
    ]

    def __init__(self):
        self.model = None
        self._train_ml_model()

    def _train_ml_model(self) -> None:
        """Entrena el pipeline de clasificación supervisada de texto con scikit-learn."""
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.linear_model import LogisticRegression
        from sklearn.pipeline import Pipeline

        # Dataset de entrenamiento con intenciones estructuradas
        dataset = [
            # GREETING
            ("hola", "greeting"),
            ("orion", "greeting"),
            ("orión", "greeting"),
            ("hola orion", "greeting"),
            ("hola orión", "greeting"),
            ("oye orion", "greeting"),
            ("oye orión", "greeting"),
            ("hey orion", "greeting"),
            ("hey orión", "greeting"),
            ("estás ahí orion", "greeting"),
            ("estás ahí orión", "greeting"),
            ("despierta orion", "greeting"),
            ("despierta orión", "greeting"),
            ("saludos orion", "greeting"),
            ("saludos orión", "greeting"),
            ("qué tal orion", "greeting"),
            ("qué tal orión", "greeting"),
            ("hola jarvis", "greeting"),
            ("hey jarvis", "greeting"),
            ("estás ahí jarvis", "greeting"),
            ("despierta jarvis", "greeting"),
            ("saludos jarvis", "greeting"),
            ("hello jarvis", "greeting"),
            ("qué tal jarvis", "greeting"),
            ("buenos días", "greeting"),
            ("buenas tardes", "greeting"),
            ("buenas noches", "greeting"),
            ("cómo estás", "greeting"),
            ("cómo te encuentras", "greeting"),

            # OPEN_CURSOR
            ("abre cursor", "open_cursor"),
            ("abrir cursor", "open_cursor"),
            ("iniciar cursor", "open_cursor"),
            ("vamos a programar", "open_cursor"),
            ("abre el editor de código", "open_cursor"),
            ("abrir editor", "open_cursor"),
            ("abre mi código", "open_cursor"),
            ("focus cursor", "open_cursor"),
            ("abrir cursor ide", "open_cursor"),
            ("modo programación", "open_cursor"),
            ("open cursor", "open_cursor"),

            # OPEN_CLAUDE
            ("abre claude", "open_claude"),
            ("abrir claude", "open_claude"),
            ("abrir claude en chrome", "open_claude"),
            ("quiero consultar con claude", "open_claude"),
            ("abre claude ai", "open_claude"),
            ("abre la inteligencia artificial", "open_claude"),
            ("abrir chat de claude", "open_claude"),
            ("iniciar claude", "open_claude"),
            ("open claude", "open_claude"),

            # OPEN_CRYPTO
            ("cómo va bitcoin", "open_crypto"),
            ("precio de bitcoin", "open_crypto"),
            ("abre binance", "open_crypto"),
            ("abrir binance", "open_crypto"),
            ("ver bitcoin", "open_crypto"),
            ("abrir tasaradar", "open_crypto"),
            ("cómo está el mercado cripto", "open_crypto"),
            ("mostrar criptomonedas", "open_crypto"),
            ("abre trading", "open_crypto"),
            ("abrir gráfica btc", "open_crypto"),
            ("open binance", "open_crypto"),

            # OPEN_MUSIC
            ("pon música", "open_music"),
            ("abre spotify", "open_music"),
            ("abrir spotify", "open_music"),
            ("reproducir música", "open_music"),
            ("pon mi canción", "open_music"),
            ("reproducir spotify", "open_music"),
            ("iniciar música", "open_music"),
            ("toca algo de música", "open_music"),
            ("quiero escuchar música", "open_music"),
            ("play music", "open_music"),
            ("play song", "open_music"),

            # SYSTEM_STATUS
            ("cómo está el sistema", "system_status"),
            ("revisar recursos", "system_status"),
            ("estado de la máquina", "system_status"),
            ("diagnóstico del sistema", "system_status"),
            ("cuánta ram libre hay", "system_status"),
            ("uso de cpu", "system_status"),
            ("cómo va la memoria", "system_status"),
            ("rendimiento del pc", "system_status"),
            ("estado del procesador", "system_status"),
            ("reporte de hardware", "system_status"),
            ("system diagnostics", "system_status"),

            # TIME_AND_DATE
            ("qué hora es", "time_and_date"),
            ("dime la hora", "time_and_date"),
            ("qué fecha es hoy", "time_and_date"),
            ("qué día es hoy", "time_and_date"),
            ("hora actual", "time_and_date"),
            ("qué hora tienes", "time_and_date"),
            ("fecha actual", "time_and_date"),
            ("en qué fecha estamos", "time_and_date"),
            ("what time is it", "time_and_date"),

            # SEARCH_WEB
            ("busca en google", "search_web"),
            ("busca en internet", "search_web"),
            ("investiga sobre", "search_web"),
            ("haz una búsqueda web de", "search_web"),
            ("buscar información de", "search_web"),
            ("googlea esto", "search_web"),
            ("busca noticias de", "search_web"),
            ("search google for", "search_web"),

            # TELL_JOKE
            ("cuéntame un chiste", "tell_joke"),
            ("dime un chiste", "tell_joke"),
            ("dime algo gracioso", "tell_joke"),
            ("hazme reír", "tell_joke"),
            ("sabes algún chiste", "tell_joke"),
            ("cuéntame una broma", "tell_joke"),
            ("dime un chiste de programadores", "tell_joke"),
            ("tell me a joke", "tell_joke"),

            # HELP
            ("qué puedes hacer", "help"),
            ("ayuda", "help"),
            ("ayúdame", "help"),
            ("cuáles son tus comandos", "help"),
            ("cómo funciona", "help"),
            ("comandos de orion", "help"),
            ("comandos de orión", "help"),
            ("ayuda orion", "help"),
            ("comandos de jarvis", "help"),
            ("menú de ayuda", "help"),
            ("qué órdenes entiendes", "help"),
            ("help", "help"),

            # EXIT
            ("apágate", "exit"),
            ("cerrar orion", "exit"),
            ("cerrar orión", "exit"),
            ("apagar orion", "exit"),
            ("apagar", "exit"),
            ("adiós orion", "exit"),
            ("adiós orión", "exit"),
            ("descansa orion", "exit"),
            ("descansa orión", "exit"),
            ("apaga el sistema", "exit"),
            ("hasta luego orion", "exit"),
            ("hasta luego orión", "exit"),
            ("terminar", "exit"),
            ("cerrar", "exit"),
            ("salir", "exit"),
            ("bye orion", "exit"),
            ("cerrar jarvis", "exit"),
            ("adiós jarvis", "exit"),
            ("descansa jarvis", "exit"),
            ("hasta luego jarvis", "exit"),
            ("bye jarvis", "exit"),

            # GENERAL_CHAT
            ("quién eres", "general_chat"),
            ("cuál es tu nombre", "general_chat"),
            ("cómo te llamas", "general_chat"),
            ("quién te creó", "general_chat"),
            ("qué opinas de la inteligencia artificial", "general_chat"),
            ("gracias orion", "general_chat"),
            ("gracias orión", "general_chat"),
            ("gracias jarvis", "general_chat"),
            ("muchas gracias", "general_chat"),
            ("eres increíble", "general_chat"),
            ("buen trabajo", "general_chat"),
            ("excelente trabajo", "general_chat"),
        ]

        texts = [x[0] for x in dataset]
        labels = [x[1] for x in dataset]

        self.model = Pipeline([
            ("tfidf", TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, lowercase=True)),
            ("clf", LogisticRegression(C=5.0, max_iter=1000, class_weight="balanced")),
        ])
        self.model.fit(texts, labels)
        log.info("🧠 Cerebro de Machine Learning entrenado con %d ejemplos.", len(dataset))

    @staticmethod
    def _preprocess_input(text: str) -> str:
        """
        Limpia y normaliza el texto. Si contiene una llamada inicial a Orión
        (ej. 'orion abre cursor', 'oye orión pon música'), extrae el comando.
        Si sólo se dijo el nombre o saludo, preserva el saludo.
        """
        if not text:
            return ""
        cleaned = text.strip().lower()

        # Quitar signos de puntuación iniciales/finales habituales
        cleaned = re.sub(r"^[¿¡\s]+|[?!.,\s]+$", "", cleaned).strip()

        # Normalizar tildes y fonéticas comunes de Orión
        norm = re.sub(r"\bori[óo]n\b", "orion", cleaned)

        # Si el usuario dijo "orion abre cursor" o "oye orión, pon música"
        prefix_pattern = r"^(?:oye|hey|hola|ok)?\s*(?:orion|jarvis)[,\s:]+"
        stripped = re.sub(prefix_pattern, "", norm).strip()

        # Si tras quitar el nombre aún queda una instrucción (ej. "abre cursor"), procesamos esa instrucción
        if stripped:
            return stripped
        return norm

    def predict_intent(self, text: str) -> tuple[str, float]:
        """Predice la intención del comando y calcula la confianza matemática (0.0 a 1.0)."""
        if not text or not text.strip():
            return ("unknown", 0.0)

        cleaned = self._preprocess_input(text)
        probs = self.model.predict_proba([cleaned])[0]
        classes = self.model.classes_
        best_idx = int(np.argmax(probs))
        confidence = float(probs[best_idx])
        intent = str(classes[best_idx])

        # Si la confianza es muy baja, clasificar como consulta general
        if confidence < 0.28:
            return ("general_chat", confidence)
        return (intent, confidence)

    def _get_system_report(self) -> str:
        """Obtiene métricas de hardware en tiempo real."""
        try:
            import psutil

            cpu = psutil.cpu_percent(interval=0.2)
            ram = psutil.virtual_memory().percent
            disk = psutil.disk_usage("/").percent if sys.platform != "win32" else psutil.disk_usage("C:\\").percent
            return (
                f"Diagnóstico del sistema: Procesador al {cpu:.0f}%, "
                f"memoria RAM en uso al {ram:.0f}%, "
                f"y almacenamiento principal al {disk:.0f}%. "
                f"Todos los subsistemas operan de manera óptima."
            )
        except Exception:
            return "Diagnóstico del sistema: Todos los procesos y subsistemas operan normalmente."

    def _get_time_and_date(self) -> str:
        now = datetime.datetime.now()
        meses = [
            "enero", "febrero", "marzo", "abril", "mayo", "junio",
            "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
        ]
        dias = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
        dia_semana = dias[now.weekday()]
        mes = meses[now.month - 1]
        return f"Son las {now.hour} horas con {now.minute:02d} minutos del {dia_semana} {now.day} de {mes}."

    def _extract_search_query(self, text: str) -> str:
        patterns = [
            r"(?:busca|buscar|investiga|investigar|googlea)\s+(?:en\s+(?:google|internet)\s+)?(?:sobre\s+|de\s+)?(.+)",
            r"(?:search\s+(?:google\s+)?(?:for\s+)?)(.+)",
        ]
        for p in patterns:
            m = re.search(p, text, re.IGNORECASE)
            if m:
                return m.group(1).strip()
        return text.strip()

    def _query_llm_if_available(self, prompt: str) -> str | None:
        """Consulta Google Gemini u OpenAI si existen claves en el entorno."""
        # 1. Google Gemini
        gemini_key = (
            os.environ.get("GEMINI_API_KEY")
            or os.environ.get("gemini_api_key")
            or ""
        ).strip()
        if gemini_key:
            try:
                from google import genai
                client = genai.Client(api_key=gemini_key)
                now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                system_instruction = (
                    f"Eres ORIÓN, un sofisticado asistente personal de inteligencia artificial con amplios conocimientos. "
                    f"La fecha y hora local actual de tu usuario es {now_str}. "
                    f"Responde de manera precisa, útil y concisa en español (máximo 1 a 3 frases claras, ideal para síntesis de voz, sin rodeos innecesarios)."
                )
                candidate_models = [
                    "gemini-2.5-flash",
                    "gemini-3.5-flash",
                    "gemini-3.6-flash",
                    "gemini-2.5-flash-lite",
                    "gemini-flash-latest",
                ]
                for mod in candidate_models:
                    try:
                        response = client.models.generate_content(
                            model=mod,
                            contents=prompt,
                            config={"system_instruction": system_instruction}
                        )
                        if response and response.text:
                            return response.text.strip()
                    except Exception as mod_err:
                        err_str = str(mod_err)
                        if "404" in err_str or "no longer available" in err_str:
                            continue
                        raise mod_err
            except Exception as e:
                log.info("Consulta Gemini no completada: %s", e)

        # 2. OpenAI
        openai_key = (
            os.environ.get("OPENAI_API_KEY")
            or os.environ.get("openai_api_key")
            or ""
        ).strip()
        if openai_key:
            try:
                from openai import OpenAI
                client = OpenAI(api_key=openai_key)
                response = client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {
                            "role": "system",
                            "content": (
                                "Eres ORIÓN, un sofisticado asistente de inteligencia artificial personal. "
                                "Responde en español de forma cortés, concisa y tecnológica en máximo 2 oraciones."
                            ),
                        },
                        {"role": "user", "content": prompt},
                    ],
                    max_tokens=200,
                )
                return response.choices[0].message.content.strip()
            except Exception as e:
                log.info("Consulta OpenAI no completada: %s", e)

        return None

    def handle_command(self, text: str) -> tuple[str, bool]:
        """
        Procesa el comando con Machine Learning y ejecuta la acción correspondiente.
        Retorna (mensaje_respuesta, debe_salir).
        """
        intent, confidence = self.predict_intent(text)
        log.info("🔍 [ML NLP] Intención: '%s' (confianza: %.1f%%)", intent, confidence * 100)

        # 1. GREETING
        if intent == "greeting":
            saludos = [
                "A sus órdenes, señor. Orión en línea con todos los sistemas listos.",
                "Hola señor. Es un placer escucharle nuevamente.",
                "Sistemas operativos al 100%. ¿Qué desea realizar hoy?",
            ]
            return random.choice(saludos), False

        # 2. OPEN_CURSOR
        elif intent == "open_cursor":
            threading.Thread(target=open_cursor_window, daemon=True).start()
            return "Abriendo Cursor IDE para continuar con el desarrollo de software.", False

        # 3. OPEN_CLAUDE
        elif intent == "open_claude":
            threading.Thread(target=open_claude_in_chrome, daemon=True).start()
            return "Abriendo Claude AI en Google Chrome, señor.", False

        # 4. OPEN_CRYPTO
        elif intent == "open_crypto":
            threading.Thread(target=open_binance_btc_in_chrome, daemon=True).start()
            return "Cargando el panel de monitoreo de mercado y Bitcoin.", False

        # 5. OPEN_MUSIC
        elif intent == "open_music":
            threading.Thread(target=lambda: play_song(SONG_URI), daemon=True).start()
            return "Iniciando reproducción de música en su reproductor.", False

        # 6. SYSTEM_STATUS
        elif intent == "system_status":
            report = self._get_system_report()
            return report, False

        # 7. TIME_AND_DATE
        elif intent == "time_and_date":
            # Si el usuario pregunta por la hora de otro lugar (ej. "hora en Francia", "hora de Los Ángeles")
            lower_raw = text.lower()
            if any(prep in lower_raw for prep in (" de ", " en ", " para ")) and not any(k in lower_raw for k in ("aquí", "aqui", "mi país", "mi pais", "hoy")):
                llm_response = self._query_llm_if_available(f"Indica la hora actual según esta consulta: '{text}'. Responde directamente la hora en una sola frase.")
                if llm_response:
                    return llm_response, False
            return self._get_time_and_date(), False

        # 8. SEARCH_WEB
        elif intent == "search_web":
            query = self._extract_search_query(text)
            encoded = urllib.parse.quote_plus(query)
            search_url = f"https://www.google.com/search?q={encoded}"
            webbrowser.open(search_url)
            return f"Buscando '{query}' en Google para usted.", False

        # 9. TELL_JOKE
        elif intent == "tell_joke":
            return random.choice(self.CHISTES), False

        # 10. HELP
        elif intent == "help":
            ayuda = (
                "Puedo ayudarle a: abrir Cursor ('abre cursor'), "
                "abrir Claude ('abre claude'), ver criptomonedas ('abre binance'), "
                "reproducir música ('pon música'), verificar el sistema ('estado del sistema'), "
                "darle la hora ('qué hora es'), buscar en internet ('busca en google...'), "
                "o responder a sus preguntas."
            )
            return ayuda, False

        # 11. EXIT
        elif intent == "exit":
            return "Apagando sistemas de Orión. Que tenga un excelente día, señor.", True

        # 12. GENERAL_CHAT / CONSULTAS
        else:
            lower_raw = text.lower()
            if any(q in lower_raw for q in ("quién eres", "quien eres", "cómo te llamas", "como te llamas", "tu nombre")):
                return "Soy Orión, su asistente inteligente con Machine Learning. Estoy a su completa disposición, señor.", False

            llm_response = self._query_llm_if_available(text)
            if llm_response:
                return llm_response, False

            respuestas_default = [
                "Comprendo su mensaje, señor. He registrado la información.",
                "Estoy a su servicio. Si necesita abrir una herramienta o verificar el sistema, solo indíquemelo.",
                "Anotado. Recuerde que puede pedirme abrir Cursor, Claude, música o diagnóstico del sistema.",
            ]
            return random.choice(respuestas_default), False


# Retrocompatibilidad de clases
JarvisMLBrain = OrionMLBrain



# BUCLE PRINCIPAL INTERACTIVO

BANNER = r"""
╔═══════════════════════════════════════════════════════════════════════╗
║                      O . R . I . Ó . N .                              ║
║         Operative Robotic Intelligent Operating Network               ║
╚═══════════════════════════════════════════════════════════════════════╝
"""


def main() -> int:
    print(BANNER)
    log.info("Inicializando componentes y hardware...")

    blocksize = block_samples()
    input_idx = _choose_input_device(blocksize)
    if input_idx is not None:
        try:
            name = sd.query_devices(input_idx)["name"]
            log.info(" Micrófono activo [%d]: %s", input_idx, name)
        except Exception:
            pass

    # 1. Inicializar cerebro de Machine Learning
    brain = OrionMLBrain()

    # 2. Saludo inmediato de bienvenida
    log.info(" Emitiendo saludo de bienvenida...")
    say_orion_welcome()

    # 3. Ejecutar acciones de arranque en segundo plano si está activado
    if RUN_STARTUP_ACTIONS_ON_LAUNCH:
        threading.Thread(target=run_startup_actions, daemon=True).start()

    # 4. Pre-calibrar reconocedor de voz persistente
    recognizer = None
    mic = None
    try:
        import speech_recognition as sr
        recognizer = sr.Recognizer()
        recognizer.dynamic_energy_threshold = True
        recognizer.pause_threshold = 0.8
        mic = sr.Microphone(device_index=input_idx)
        with mic as source:
            log.info("Calibrando micrófono para su entorno...")
            recognizer.adjust_for_ambient_noise(source, duration=0.8)
    except Exception as e:
        log.warning("No se pudo pre-calibrar el micrófono: %s", e)

    print("\n" + "=" * 71)
    print(" 🎙️ ORIÓN EN MODO MANOS LIBRES (ESCUCHA CONTINUA ACTIVADA)")
    print("  • Hable directamente al micrófono sin presionar teclas.")
    print("  • Ejemplos: 'Orión, qué hora es', 'Orión pon música', 'Abre cursor'.")
    print("  • Si desea escribir un comando por texto, presione cualquier tecla.")
    print("  • Para apagar a Orión, diga 'apágate' o presione Ctrl+C.")
    print("=" * 71 + "\n")

    try:
        while True:
            command_text = None

            # Opción 1: Detectar si el usuario presionó una tecla para modo texto en consola
            if sys.platform == "win32":
                import msvcrt
                if msvcrt.kbhit():
                    try:
                        msvcrt.getch()  # Consumir la tecla presionada
                        command_text = input("\n[ORIÓN TECLADO] >> ").strip()
                    except (EOFError, KeyboardInterrupt):
                        break

            # Opción 2: Si no escribió por teclado, escuchar por micrófono de forma continua
            if not command_text:
                voice_text = listen_microphone(
                    device_index=input_idx,
                    timeout=4.0,
                    phrase_time_limit=8.0,
                    recognizer=recognizer,
                    microphone=mic,
                    show_listening_prompt=True,
                )
                if not voice_text:
                    continue
                print(f"\n👤 [USTED DIJO]: \"{voice_text}\"")
                command_text = voice_text

            # Procesar el comando con Machine Learning
            response, should_exit = brain.handle_command(command_text)

            # Responder vocalmente y por consola
            orion_speak(response, wait=True)

            if should_exit:
                break

    except KeyboardInterrupt:
        print("\n")
        log.info("Interrupción por teclado detectada.")
        orion_speak("Hasta luego, señor.", wait=False)
        time.sleep(1.0)

    log.info("Orión finalizado correctamente.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
