// Adicione log de inicialização
console.log("Script page_capture carregado");

// Este script será injetado na página para capturar o áudio
let mediaRecorder = null;
let audioChunks = [];

async function captureTabAudio() {
  try {
    console.log("Verificando domínio atual...");
    
    // Verificar se é um site com restrições conhecidas
    const restrictedSites = [
      'youtube.com',
      'netflix.com',
      'spotify.com',
      'disneyplus.com'
      // WhatsApp removido da lista
    ];
    const currentDomain = window.location.hostname;
    
    const isRestricted = restrictedSites.some(site => currentDomain.includes(site));
    if (isRestricted) {
      console.warn(`Aviso: ${currentDomain} pode ter restrições de captura de áudio devido à proteção DRM.`);
      // Continuamos mesmo assim, mas avisamos o usuário
    }
    
    console.log("Solicitando permissão de captura...");
    
    // Tentar com configurações diferentes
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      },
      video: {
        width: 1,
        height: 1,
        frameRate: 1
      }
    });
    
    // Remover as trilhas de vídeo mantendo apenas o áudio
    stream.getVideoTracks().forEach(track => {
      track.enabled = false;
      track.stop();
      stream.removeTrack(track);
    });
    
    console.log("Permissão concedida, configurando gravador...");
    
    // Verificar o formato suportado
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      console.warn("Codec opus não suportado, usando formato padrão");
      mimeType = 'audio/webm';
    }
    
    // Configura o MediaRecorder
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: mimeType,
      audioBitsPerSecond: 128000
    });
    
    audioChunks = [];
    
    mediaRecorder.ondataavailable = (e) => {
      console.log("Chunk de áudio recebido:", e.data.size, "bytes");
      if (e.data.size > 0) {
        audioChunks.push(e.data);
      }
    };
    
    mediaRecorder.onstop = () => {
      console.log("Gravação parada, processando...");
      // Cria um blob a partir dos chunks
      const audioBlob = new Blob(audioChunks, { 
        type: mimeType
      });
      
      console.log("Áudio gerado:", audioBlob.size, "bytes");
      
      // Convertemos para base64 para enviar
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64Audio = reader.result.split(',')[1];
        console.log("Áudio convertido para base64, enviando...");
        // Envia para a extensão
        window.postMessage({
          source: 'PAGE_CAPTURE',
          action: 'audioRecorded',
          audio: base64Audio,
          mimeType: mimeType
        }, '*');
      };
      reader.readAsDataURL(audioBlob);
      
      // Limpa os recursos
      stream.getTracks().forEach(track => track.stop());
    };
    
    // Inicia a gravação
    mediaRecorder.start(1000);
    console.log("Gravação iniciada com sucesso!");
    
    window.postMessage({
      source: 'PAGE_CAPTURE',
      action: 'recordingStarted'
    }, '*');
    
    return true;
  } catch (error) {
    console.error("Erro ao capturar áudio:", error);
    window.postMessage({
      source: 'PAGE_CAPTURE',
      action: 'recordingError',
      error: error.message
    }, '*');
    return false;
  }
}

function stopCapture() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

// Adicione mais logs ao listener de mensagens
window.addEventListener('message', (event) => {
  console.log("Page capture recebeu mensagem:", event.data);
  
  if (event.data.source === 'EXTENSION' && event.data.action === 'startCapture') {
    console.log("Iniciando captura de áudio...");
    captureTabAudio();
  } else if (event.data.source === 'EXTENSION' && event.data.action === 'stopCapture') {
    console.log("Parando captura de áudio...");
    stopCapture();
  }
});

// Notify that we're ready
window.postMessage({
  source: 'PAGE_CAPTURE',
  action: 'ready'
}, '*'); 