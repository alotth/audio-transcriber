import os
import urllib.request
from pathlib import Path
from faster_whisper import WhisperModel
import base64
from pydub import AudioSegment
import logging
from pyannote.audio import Pipeline
import torch
import sys
import timeout_decorator
from pydub.silence import detect_nonsilent

# Set up logging configuration
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

# Configurar handlers de arquivo separadamente
debug_handler = logging.FileHandler('transcription_debug.log')
debug_handler.setLevel(logging.DEBUG)

info_handler = logging.FileHandler('transcription.log')
info_handler.setLevel(logging.INFO)

# Adicionar formatador aos handlers
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
debug_handler.setFormatter(formatter)
info_handler.setFormatter(formatter)

# Adicionar handlers ao logger root
logging.getLogger().addHandler(debug_handler)
logging.getLogger().addHandler(info_handler)

# Variável global para o pipeline
DIARIZATION_PIPELINE = None

# Definir timeout de 5 minutos (300 segundos)
DIARIZATION_TIMEOUT = 300


def setup_pyannote_local():
    """Configure Pyannote to use local model files in a shared location"""
    global DIARIZATION_PIPELINE
    logging.info("Starting Pyannote setup...")

    try:
        # Seu token HuggingFace
        HF_TOKEN = os.getenv("HF_TOKEN")

        logging.info("Loading Pyannote pipeline...")
        DIARIZATION_PIPELINE = Pipeline.from_pretrained(
            "pyannote/speaker-diarization@2.1",
            use_auth_token=HF_TOKEN
        )

        logging.info("Successfully initialized Pyannote pipeline")
        return DIARIZATION_PIPELINE

    except Exception as e:
        logging.error(f"Failed to initialize Pyannote pipeline: {e}")
        raise


def get_diarization_pipeline():
    """Get the global diarization pipeline"""
    global DIARIZATION_PIPELINE
    if DIARIZATION_PIPELINE is None:
        raise RuntimeError(
            "Pyannote pipeline not initialized. Please run setup_pyannote_local() first")
    return DIARIZATION_PIPELINE


@timeout_decorator.timeout(DIARIZATION_TIMEOUT)
def perform_diarization(audio_path):
    logging.info(f"Starting diarization for: {audio_path}")
    try:
        pipeline = get_diarization_pipeline()
        logging.info("Running diarization pipeline...")
        diarization = pipeline(audio_path)

        speaker_segments = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            speaker_segments.append({
                'speaker': speaker,
                'start': turn.start,
                'end': turn.end
            })

        logging.info(
            f"Diarization completed with {len(speaker_segments)} segments")
        return speaker_segments
    except timeout_decorator.TimeoutError:
        logging.error(
            f"Diarization timed out after {DIARIZATION_TIMEOUT} seconds")
        raise
    except Exception as e:
        logging.error(f"Diarization failed: {e}")
        raise


@timeout_decorator.timeout(60)  # timeout de 1 minuto para conversão
def convert_audio_to_wav(raw_path):
    """Converte áudio para WAV para melhor compatibilidade"""
    logging.info(f"Converting audio file to WAV: {raw_path}")
    try:
        logging.debug("Loading audio file using pydub")
        audio = AudioSegment.from_file(raw_path)

        # Converter para WAV com configurações específicas
        audio = audio.set_channels(1)  # mono
        audio = audio.set_frame_rate(16000)  # 16kHz

        wav_path = raw_path.replace('.opus', '.wav').replace(
            '.ogg', '.wav').replace('.mp3', '.wav')
        logging.debug(f"Exporting to WAV format at: {wav_path}")
        audio.export(wav_path, format="wav")
        logging.info(f"Successfully converted to WAV: {wav_path}")
        return wav_path
    except timeout_decorator.TimeoutError:
        logging.error("Audio conversion timed out after 60 seconds")
        raise
    except Exception as e:
        logging.error(f"Audio conversion failed: {e}")
        raise


def split_audio(audio_path, segment_duration=30):
    """Divide o áudio em segmentos menores"""
    logging.info(f"Splitting audio into {segment_duration}s segments")
    try:
        audio = AudioSegment.from_file(audio_path)
        total_duration = len(audio)
        segments = []

        for start in range(0, total_duration, segment_duration * 1000):
            end = min(start + segment_duration * 1000, total_duration)
            segment = audio[start:end]

            # Salvar segmento temporário
            temp_path = f"temp_segment_{len(segments)}.wav"
            segment = segment.set_channels(1).set_frame_rate(16000)
            segment.export(temp_path, format="wav")
            segments.append({
                'path': temp_path,
                'start': start / 1000,  # converter para segundos
                'end': end / 1000
            })

        logging.info(f"Split audio into {len(segments)} segments")
        return segments
    except Exception as e:
        logging.error(f"Failed to split audio: {e}")
        raise


@timeout_decorator.timeout(60)  # timeout de 1 minuto por segmento
def process_segment(segment_info, pipeline):
    """Processa um único segmento de áudio"""
    try:
        diarization = pipeline(segment_info['path'])
        speaker_segments = []

        for turn, _, speaker in diarization.itertracks(yield_label=True):
            # Ajustar tempos para o áudio original
            speaker_segments.append({
                'speaker': speaker,
                'start': segment_info['start'] + turn.start,
                'end': segment_info['start'] + turn.end
            })

        return speaker_segments
    finally:
        # Limpar arquivo temporário
        if os.path.exists(segment_info['path']):
            os.remove(segment_info['path'])


def detect_speaker_changes(audio_segment, min_silence_len=700, silence_thresh=-40):
    """Detecta mudanças de falante baseado em silêncios"""
    # Detectar períodos não silenciosos
    nonsilent_ranges = detect_nonsilent(
        audio_segment,
        min_silence_len=min_silence_len,  # 700ms de silêncio
        silence_thresh=silence_thresh      # -40 dB
    )

    # Converter para o formato de segmentos
    segments = []
    current_speaker = 1
    last_end = 0

    for start, end in nonsilent_ranges:
        # Se houver um gap significativo, considera mudança de falante
        if start - last_end > min_silence_len * 2:  # Gap maior que 1.4s
            current_speaker = (current_speaker % 2) + 1  # Alterna entre 1 e 2

        segments.append({
            'start': start / 1000.0,  # Converter para segundos
            'end': end / 1000.0,
            'speaker': f"SPEAKER_{current_speaker}"
        })
        last_end = end

    return segments


def process_audio_segments(audio_path):
    """Processa o áudio identificando falantes por silêncio e transcrevendo"""
    logging.info(f"Processing audio: {audio_path}")

    try:
        # 1. Converter para WAV
        wav_path = convert_audio_to_wav(audio_path)

        # 2. Carregar o áudio
        audio = AudioSegment.from_file(wav_path)

        # 3. Detectar segmentos por falante
        logging.info("Detecting speaker segments")
        speaker_segments = detect_speaker_changes(audio)
        logging.info(f"Found {len(speaker_segments)} segments")

        # 4. Inicializar Whisper
        logging.debug("Initializing Whisper model")
        try:
            model = WhisperModel("base", device="mps", compute_type="float16")
            logging.info("Successfully initialized model with MPS")
        except ValueError:
            logging.info("Switching to CPU...")
            model = WhisperModel("base", device="cpu", compute_type="float32")
            logging.info("Successfully initialized model with CPU")

        # 5. Transcrever cada segmento
        final_transcription = []

        for idx, segment in enumerate(speaker_segments, 1):
            try:
                # Extrair o segmento de áudio
                start_ms = int(segment['start'] * 1000)
                end_ms = int(segment['end'] * 1000)
                audio_segment = audio[start_ms:end_ms]

                # Salvar temporariamente
                temp_path = f"temp_whisper_{idx}.wav"
                audio_segment.export(temp_path, format="wav")

                # Transcrever o segmento
                logging.debug(
                    f"Transcribing segment {idx} for {segment['speaker']}")
                result = list(model.transcribe(temp_path, language="pt")[0])

                # Combinar as transcrições do segmento
                text = " ".join(s.text for s in result)
                if text.strip():  # Só adiciona se tiver texto
                    final_transcription.append(
                        f"[{segment['speaker']}]: {text}")

                # Limpar arquivo temporário
                os.remove(temp_path)

                logging.debug(
                    f"Processed segment {idx}/{len(speaker_segments)}")

            except Exception as e:
                logging.error(f"Failed to process segment {idx}: {e}")
                continue

        # Limpar arquivo WAV temporário
        os.remove(wav_path)

        logging.info(
            f"Successfully processed {len(final_transcription)} segments")
        return "\n".join(final_transcription)

    except Exception as e:
        logging.error(f"Failed to process audio: {e}")
        raise


if __name__ == "__main__":
    logging.info("Starting transcription process...")

    try:
        logging.info("Setting up required models and directories")

        # Tentar inicializar o Pyannote e verificar se foi bem sucedido
        if setup_pyannote_local() is None:
            logging.error("Failed to initialize Pyannote pipeline")
            raise RuntimeError("Failed to initialize Pyannote pipeline")

        logging.info("All required models initialized successfully")

        logging.debug("Creating necessary directories")
        os.makedirs("audios", exist_ok=True)
        transcriptions_dir = "transcriptions"
        os.makedirs(transcriptions_dir, exist_ok=True)

        # Verificar se podemos escrever no diretório de transcrições
        output_path = os.path.join(transcriptions_dir, "transcriptions.txt")
        try:
            with open(output_path, "a") as f:
                f.write("")  # Teste de escrita
            logging.info(
                f"Successfully verified write access to {output_path}")
        except Exception as e:
            logging.error(f"Cannot write to transcriptions file: {e}")
            raise

        audio_files = os.listdir("audios")
        logging.info(f"Found {len(audio_files)} audio files to process")

        for idx, file in enumerate(audio_files, 1):
            logging.info(f"Processing file {idx}/{len(audio_files)}: {file}")
            try:
                audio_path = os.path.join("audios", file)
                logging.debug(f"Full audio path: {audio_path}")

                logging.info("Starting transcription process")
                transcription = process_audio_segments(audio_path)

                logging.debug(f"Saving transcription to: {output_path}")
                with open(output_path, "a", encoding='utf-8') as f:
                    f.write(f"\n# {file}\n\n{transcription}\n\n")
                logging.info(f"Successfully saved transcription for {file}")

            except Exception as e:
                logging.error(f"Failed to process {file}: {e}")
                logging.debug("Error details:", exc_info=True)
                continue

        logging.info("Transcription process completed successfully")

    except Exception as e:
        logging.error(f"Program failed: {e}")
        logging.debug("Error details:", exc_info=True)
        raise
