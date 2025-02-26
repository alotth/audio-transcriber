// Adicione esses logs no início do arquivo para debug
console.log("Content script carregado");

function getMeetParticipants() {
  // Se não estiver no Meet, retorna array vazio
  if (!window.location.hostname.includes("meet.google.com")) {
    return [];
  }

  const participants = [];

  // Seletores específicos do Meet
  const participantElements = document.querySelectorAll(
    "[data-participant-id]"
  );

  participantElements.forEach((element) => {
    const name = element.querySelector(".ZjFb7c").textContent;
    participants.push(name);
  });

  return participants;
}

function getPageInfo() {
  return {
    title: document.title,
    url: window.location.href,
    timestamp: new Date().toISOString(),
  };
}

// Envia a lista de participantes e informações da página quando solicitado
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getPageInfo") {
    const info = {
      participants: getMeetParticipants(),
      page: getPageInfo(),
    };
    sendResponse(info);
  } else if (request.action === "startRecording") {
    startRecording();
  } else if (request.action === "stopRecording") {
    stopRecording();
  }
});

let mediaRecorder = null;
let audioStream = null;

async function startRecording() {
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ 
      audio: true,
      video: false
    });
    
    mediaRecorder = new MediaRecorder(audioStream);
    const chunks = [];

    mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
    
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      chrome.runtime.sendMessage({
        action: "audioRecorded",
        audio: blob
      });
      
      // Limpa os recursos
      audioStream.getTracks().forEach(track => track.stop());
      audioStream = null;
    };

    mediaRecorder.start();
    chrome.runtime.sendMessage({ action: "recordingStarted" });
  } catch (error) {
    console.error("Erro ao iniciar gravação:", error);
    chrome.runtime.sendMessage({ 
      action: "recordingError",
      error: error.message
    });
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
}

// Injetamos o script na página
function injectPageCaptureScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('page_capture.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

// Inicializamos
injectPageCaptureScript();

// Escuta mensagens da página
window.addEventListener('message', (event) => {
  // Somente aceita mensagens do nosso script
  if (event.data && event.data.source === 'PAGE_CAPTURE') {
    // Encaminha para a extensão
    chrome.runtime.sendMessage(event.data);
  }
});

// Escuta mensagens da extensão
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Content script recebeu mensagem:", message);
  
  if (message.action === "ping") {
    // Adicionando handler de ping para verificar se o content script está funcionando
    console.log("Ping recebido, respondendo com pong");
    sendResponse({ status: "ok" });
  } else if (message.action === "startRecording") {
    console.log("Iniciando gravação via página");
    window.postMessage({
      source: 'EXTENSION',
      action: 'startCapture'
    }, '*');
    sendResponse({ status: "started" });
  } else if (message.action === "stopRecording") {
    console.log("Parando gravação via página");
    window.postMessage({
      source: 'EXTENSION',
      action: 'stopCapture'
    }, '*');
    sendResponse({ status: "stopped" });
  }
  return true; // Importante: mantém o canal de mensagem aberto para respostas assíncronas
});

// Adicionar função para verificar compatibilidade
function checkCompatibility() {
  const restrictedSites = ['youtube.com', 'netflix.com', 'spotify.com', 'disneyplus.com'];
  const currentDomain = window.location.hostname;
  
  const isRestricted = restrictedSites.some(site => currentDomain.includes(site));
  if (isRestricted) {
    chrome.runtime.sendMessage({
      action: "compatibilityWarning",
      message: `O site ${currentDomain} pode ter restrições para captura de áudio devido à proteção DRM.`
    });
  }
}

// Chamar ao inicializar
checkCompatibility();
