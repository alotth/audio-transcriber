import os
import urllib.request
from pathlib import Path
from faster_whisper import WhisperModel
import base64
from pydub import AudioSegment
import logging

# Set up logging configuration
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('transcription.log'),
        logging.StreamHandler()
    ]
)

def setup_tesseract_local():
    """Configure Tesseract to use local language files in the venv"""
    logging.info("Starting Tesseract setup...")
    # Define paths
    venv_path = Path(os.environ.get('VIRTUAL_ENV', '.venv'))
    tessdata_path = venv_path / 'tessdata'

    # Create tessdata directory if it doesn't exist
    tessdata_path.mkdir(exist_ok=True)
    logging.info(f"Using tessdata path: {tessdata_path}")

    # Download Portuguese language data if needed
    por_traineddata = tessdata_path / 'por.traineddata'
    if not por_traineddata.exists():
        logging.info("Portuguese language data not found. Downloading...")
        url = "https://github.com/tesseract-ocr/tessdata/raw/main/por.traineddata"
        try:
            urllib.request.urlretrieve(url, por_traineddata)
            logging.info("Successfully downloaded Portuguese language data")
        except Exception as e:
            logging.error(f"Failed to download language data: {e}")
            raise

    # Set environment variable to use local tessdata
    os.environ['TESSDATA_PREFIX'] = str(tessdata_path)
    logging.info(f"Tesseract data directory set to: {tessdata_path}")
    return tessdata_path


def transcribe_audio(audio_path):
    logging.info(f"Starting transcription of: {audio_path}")
    try:
        # Para Mac com Apple Silicon (M1/M2/M3)
        logging.info("Attempting to use MPS (Apple Silicon)...")
        model = WhisperModel("base", device="mps", compute_type="float16")
        logging.info("Successfully initialized model with MPS")
    except Exception as e:
        logging.warning(f"Failed to use MPS: {e}")
        logging.info("Switching to CPU...")
        # Fallback para CPU
        model = WhisperModel("base", device="cpu", compute_type="float32")
        logging.info("Successfully initialized model with CPU")

    try:
        segments, info = model.transcribe(audio_path, language="pt")
        transcription = " ".join([segment.text for segment in segments])
        logging.info(f"Transcription completed. Length: {len(transcription)} characters")
        return transcription
    except Exception as e:
        logging.error(f"Transcription failed: {e}")
        raise


def convert_audio_to_mp3(raw_path):
    logging.info(f"Converting audio file: {raw_path}")
    try:
        audio = AudioSegment.from_file(raw_path)
        mp3_path = raw_path.replace('.opus', '.mp3')
        audio.export(mp3_path, format="mp3")
        logging.info(f"Successfully converted to MP3: {mp3_path}")
        return mp3_path
    except Exception as e:
        logging.error(f"Audio conversion failed: {e}")
        raise


if __name__ == "__main__":
    logging.info("Starting transcription process...")
    
    try:
        setup_tesseract_local()
        
        # Ensure directories exist
        os.makedirs("audios", exist_ok=True)
        os.makedirs("transcriptions", exist_ok=True)
        
        audio_files = os.listdir("audios")
        logging.info(f"Found {len(audio_files)} audio files to process")
        
        for file in audio_files:
            logging.info(f"Processing file: {file}")
            try:
                audio_path = os.path.join("audios", file)
                mp3_path = convert_audio_to_mp3(audio_path)
                transcription = transcribe_audio(mp3_path)
                
                # Save transcription to the transcription txt file
                output_path = os.path.join("transcriptions", f"transcriptions.txt")
                with open(output_path, "a") as f:
                    # Add the file name to the transcription
                    f.write(f"# {file}\n\n{transcription}\n\n")
                logging.info(f"Transcription saved to {output_path}")
                
            except Exception as e:
                logging.error(f"Failed to process {file}: {e}")
                continue
                
        logging.info("Transcription process completed successfully")
        
    except Exception as e:
        logging.error(f"Program failed: {e}")
        raise
