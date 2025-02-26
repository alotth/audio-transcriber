let recorder = null;
let audioChunks = [];

// Escuta mensagens do background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Mensagem recebida na página offscreen:", message);
  
  if (message.action === "startRecording") {
    startRecording()
      .then(result => sendResponse(result))
      .catch(error => {
        console.error("Erro na captura:", error);
        sendResponse({ 
          success: false, 
          error: error.message || "Erro na captura de áudio" 
        });
      });
    return true;
  } else if (message.action === "stopRecording") {
    stopRecording();
    sendResponse({ success: true });
    return true;
  } else if (message.action === "startRecordingWithStreamId") {
    startRecordingWithStreamId(message.streamId)
      .then(result => sendResponse(result))
      .catch(error => {
        console.error("Erro na captura:", error);
        sendResponse({ 
          success: false, 
          error: error.message || "Erro na captura de áudio" 
        });
      });
    return true;
  } else if (message.action === "captureTabAudio") {
    captureTabAudio(message.tabId)
      .then(result => sendResponse(result))
      .catch(error => {
        console.error("Erro na captura:", error);
        sendResponse({ 
          success: false, 
          error: error.message || "Erro na captura de áudio" 
        });
      });
    return true;
  }
});

// Função para inicializar a gravação com um stream já existente
function initializeRecording(stream) {
  try {
    console.log("Inicializando gravação na página offscreen");

    // Configura o MediaRecorder
    recorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
      audioBitsPerSecond: 128000,
    });

    audioChunks = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        audioChunks.push(e.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(audioChunks, { type: "audio/webm;codecs=opus" });

      // Envia o áudio para o background script
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64Audio = reader.result.split(",")[1];
        chrome.runtime.sendMessage({
          action: "audioRecorded",
          audio: base64Audio,
          mimeType: "audio/webm;codecs=opus",
        });
      };
      reader.readAsDataURL(blob);
    };

    // Inicia a gravação
    recorder.start(1000);
    return Promise.resolve({ success: true });
  } catch (error) {
    console.error("Erro ao inicializar gravação:", error);
    return Promise.resolve({ success: false, error: error.message });
  }
}

function stopRecording() {
  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
  }
}

// Implementação completa do startRecording
async function startRecording() {
  try {
    console.log("Iniciando gravação na página offscreen");
    
    // Solicitar permissão ao usuário - isso funciona na página offscreen
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: { width: 1, height: 1 }
    });
    
    // Remover as trilhas de vídeo para economizar recursos
    stream.getVideoTracks().forEach(track => {
      track.stop();
    });
    
    // Mantém apenas o áudio
    const audioStream = new MediaStream(stream.getAudioTracks());
    
    // Opcional: Capturar também o microfone
    let micStream = null;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { 
          echoCancellation: true,
          noiseSuppression: true 
        },
        video: false
      });
      console.log("Microfone capturado com sucesso");
    } catch (err) {
      console.log("Microfone não disponível:", err);
    }
    
    // Configura o MediaRecorder com o stream apropriado
    let finalStream = audioStream;
    
    // Se temos microfone, combina os streams
    if (micStream) {
      finalStream = combineTracks(audioStream, micStream);
    }
    
    // Inicializa a gravação
    return initializeRecording(finalStream);
  } catch (error) {
    console.error("Erro ao capturar áudio:", error);
    return { 
      success: false, 
      error: error.message || "Falha ao iniciar a captura de áudio" 
    };
  }
}

// Função auxiliar para combinar streams de áudio
function combineTracks(displayStream, micStream) {
  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();
  
  // Adiciona o áudio da aba/display
  if (displayStream.getAudioTracks().length > 0) {
    const source1 = audioContext.createMediaStreamSource(displayStream);
    source1.connect(destination);
  }
  
  // Adiciona o áudio do microfone
  if (micStream.getAudioTracks().length > 0) {
    const source2 = audioContext.createMediaStreamSource(micStream);
    source2.connect(destination);
  }
  
  return destination.stream;
}

// Nova função para iniciar gravação com streamId
async function startRecordingWithStreamId(streamId) {
  try {
    console.log("Iniciando gravação com streamId na página offscreen");
    
    // Usar o streamId para obter o stream de mídia da aba
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId
        }
      },
      video: false // apenas áudio
    });
    
    // Opcional: capturar também o microfone
    let micStream = null;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { 
          echoCancellation: true,
          noiseSuppression: true 
        },
        video: false
      });
      console.log("Microfone capturado com sucesso");
    } catch (err) {
      console.log("Microfone não disponível:", err);
    }
    
    // Configura o MediaRecorder com o stream apropriado
    let finalStream = stream;
    
    // Se temos microfone, combina os streams
    if (micStream) {
      finalStream = combineTracks(stream, micStream);
    }
    
    // Inicializa a gravação
    return initializeRecording(finalStream);
  } catch (error) {
    console.error("Erro ao capturar áudio com streamId:", error);
    return { 
      success: false, 
      error: error.message || "Falha ao iniciar a captura de áudio" 
    };
  }
}

// Função para capturar áudio da aba pelo ID
async function captureTabAudio(tabId) {
  try {
    console.log("Capturando áudio da aba ID:", tabId);
    
    // Capturar áudio da aba usando chrome.tabCapture
    const stream = await new Promise((resolve, reject) => {
      chrome.tabCapture.capture(
        {
          audio: true,
          video: false,
          tabId: tabId
        },
        (stream) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!stream) {
            reject(new Error("Não foi possível capturar o áudio da aba"));
          } else {
            resolve(stream);
          }
        }
      );
    });
    
    // Capturar microfone opcionalmente
    let micStream = null;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { 
          echoCancellation: true,
          noiseSuppression: true 
        },
        video: false
      });
      console.log("Microfone capturado com sucesso");
    } catch (err) {
      console.log("Microfone não disponível:", err);
    }
    
    // Combinar streams se necessário
    let finalStream = stream;
    if (micStream) {
      finalStream = combineTracks(stream, micStream);
    }
    
    // Iniciar gravação
    return await initializeRecording(finalStream);
  } catch (error) {
    console.error("Erro ao capturar áudio da aba:", error);
    return { 
      success: false, 
      error: error.message || "Falha ao capturar áudio da aba" 
    };
  }
}
