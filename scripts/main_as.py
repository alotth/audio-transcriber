import os
import logging
import sys
import assemblyai as aai
import argparse
from dotenv import load_dotenv

load_dotenv()

ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY")

# Configuração do logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        # Sobrescreve o log a cada execução
        logging.FileHandler('transcription.log', mode='w')
    ]
)
logger = logging.getLogger(__name__)


def transcribe_audio(api_key, audio_path, output_path, speaker_labels=True, content_safety=False, iab_categories=False):
    """
    Transcreve um arquivo de áudio usando a API da AssemblyAI.

    Args:
        api_key (str): Sua chave da API da AssemblyAI.
        audio_path (str): Caminho para o arquivo de áudio.
        output_path (str): Caminho para salvar a transcrição.
        speaker_labels (bool): Ativa/desativa a diarização (rótulos de falantes).
        content_safety (bool): Ativa/desativa a detecção de conteúdo sensível.
        iab_categories (bool): Ativa a categorização do conteúdo (IAB).
    """

    aai.settings.api_key = api_key

    config = aai.TranscriptionConfig(
        speaker_labels=speaker_labels,  # Diarização
        content_safety=content_safety,  # Detecção de conteúdo sensível
        iab_categories=iab_categories,  # Categorização
        language_code="pt"  # Definindo português como idioma
    )

    try:
        # Verifica se é uma URL
        if audio_path.startswith("http://") or audio_path.startswith("https://"):
            transcriber = aai.Transcriber()
            transcript = transcriber.transcribe(audio_path, config=config)
        else:
            # Se não for, assume que é um caminho local
            if not os.path.exists(audio_path):
                raise FileNotFoundError(
                    f"Arquivo de áudio não encontrado: {audio_path}")

            transcriber = aai.Transcriber()
            transcript = transcriber.transcribe(audio_path, config=config)

        if transcript.status == aai.TranscriptStatus.error:
            logger.error(f"Erro na transcrição: {transcript.error}")
            return

        # Formata a saída com os rótulos dos falantes (diarização)
        formatted_transcription = ""
        if speaker_labels and hasattr(transcript, 'utterances') and transcript.utterances:
            for utterance in transcript.utterances:
                formatted_transcription += f"[Speaker {utterance.speaker}]: {utterance.text}\n"
        else:
            formatted_transcription = transcript.text

        # Salva a transcrição no arquivo único
        output_file = os.path.join(output_path, "transcriptions.txt")
        with open(output_file, "a", encoding='utf-8') as f:
            f.write(f"\n# {os.path.basename(audio_path)}\n\n")
            f.write(formatted_transcription)
            f.write("\n\n")

            # Verifica se os atributos existem antes de tentar acessá-los
            if content_safety and hasattr(transcript, 'content_safety'):
                results = getattr(transcript.content_safety, 'results', [])
                if results:
                    f.write("\nConteúdo sensível detectado:\n")
                    # for result in results:
                    #     f.write(f"  - {result.text}: {result.severity}\n")

            if iab_categories and hasattr(transcript, 'iab_categories'):
                results = getattr(transcript.iab_categories, 'results', [])
                if results:
                    f.write("\nCategorias IAB detectadas:\n")
                    for result in results:
                        f.write(f"  - {result.text}\n")

            f.write("\n" + "-"*50 + "\n")  # Separador entre transcrições

        logger.info(f"Transcrição salva em: {output_file}")

        # Imprime informações adicionais no log
        if content_safety and hasattr(transcript, 'content_safety'):
            results = getattr(transcript.content_safety, 'results', [])
            if results:
                logger.info("Conteúdo sensível detectado:")
                # for result in results:
                #     logger.info(f"  - {result.text}: {result.severity}")

        if iab_categories and hasattr(transcript, 'iab_categories'):
            results = getattr(transcript.iab_categories, 'results', [])
            if results:
                logger.info("Categorias IAB detectadas:")
                for result in results:
                    logger.info(f" - {result.text}")

    except FileNotFoundError as e:
        logger.error(e)
    except Exception as e:
        logger.exception(f"Erro inesperado durante a transcrição: {e}")


def main():
    """
    Função principal que processa os arquivos de áudio no diretório 'audios' 
    e salva as transcrições no diretório 'transcriptions'.
    """
    # Obtém a chave da API
    api_key = os.environ.get("ASSEMBLYAI_API_KEY")
    if not api_key:
        logger.error(
            "Chave da API da AssemblyAI não encontrada. Defina a variável de ambiente ASSEMBLYAI_API_KEY.")
        sys.exit(1)

    # Cria os diretórios necessários
    os.makedirs("audios", exist_ok=True)
    transcriptions_dir = "transcriptions"
    os.makedirs(transcriptions_dir, exist_ok=True)

    # Verifica se há arquivos de áudio para processar
    audio_files = [f for f in os.listdir("audios") if f.lower().endswith(
        ('.mp3', '.wav', '.ogg', '.opus', '.m4a'))]

    if not audio_files:
        logger.error(
            "Nenhum arquivo de áudio encontrado no diretório 'audios'")
        sys.exit(1)

    logger.info(
        f"Encontrados {len(audio_files)} arquivos de áudio para processar")

    # Processa cada arquivo de áudio
    for idx, file in enumerate(audio_files, 1):
        logger.info(f"Processando arquivo {idx}/{len(audio_files)}: {file}")
        try:
            audio_path = os.path.join("audios", file)

            # Transcreve o áudio com configurações padrão
            transcribe_audio(api_key, audio_path, transcriptions_dir,
                             speaker_labels=True, content_safety=True, iab_categories=False)

        except Exception as e:
            logger.error(f"Falha ao processar {file}: {e}")
            logger.debug("Detalhes do erro:", exc_info=True)
            continue

    logger.info("Processo de transcrição concluído com sucesso")


if __name__ == "__main__":
    main()
