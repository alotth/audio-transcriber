// Content script específico para o Google Meet
console.log("Meet content script carregado");

let statusIndicator = null;
let isRecording = false;

// Inicializa o indicador de status
function createStatusIndicator() {
  // Remove qualquer indicador existente
  if (statusIndicator) {
    statusIndicator.remove();
  }

  // Cria o elemento visual
  statusIndicator = document.createElement('div');
  statusIndicator.className = 'audio-transcriber-status';
  statusIndicator.innerHTML = `
    <div class="status-indicator">
      <div class="indicator-icon"></div>
      <span class="status-text">Pronto para gravar</span>
    </div>
  `;

  // Estiliza o elemento
  const style = document.createElement('style');
  style.textContent = `
    .audio-transcriber-status {
      position: fixed;
      bottom: 80px;
      right: 20px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 10px 15px;
      border-radius: 20px;
      font-family: 'Google Sans', sans-serif;
      z-index: 9999;
      display: flex;
      align-items: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      transition: all 0.3s ease;
    }
    .status-indicator {
      display: flex;
      align-items: center;
    }
    .indicator-icon {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background-color: #888;
      margin-right: 8px;
    }
    .indicator-icon.recording {
      background-color: #EA4335;
      box-shadow: 0 0 0 rgba(234, 67, 53, 0.4);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0% {
        box-shadow: 0 0 0 0 rgba(234, 67, 53, 0.4);
      }
      70% {
        box-shadow: 0 0 0 10px rgba(234, 67, 53, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(234, 67, 53, 0);
      }
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(statusIndicator);
  
  return statusIndicator;
}

// Atualiza o status visual
function updateStatus(status) {
  if (!statusIndicator) {
    statusIndicator = createStatusIndicator();
  }
  
  const icon = statusIndicator.querySelector('.indicator-icon');
  const text = statusIndicator.querySelector('.status-text');
  
  switch(status) {
    case 'recording':
      icon.classList.add('recording');
      text.textContent = 'Gravando...';
      isRecording = true;
      break;
    case 'stopped':
      icon.classList.remove('recording');
      text.textContent = 'Processando...';
      isRecording = false;
      break;
    case 'ready':
      icon.classList.remove('recording');
      text.textContent = 'Pronto para gravar';
      isRecording = false;
      break;
    case 'error':
      icon.classList.remove('recording');
      text.textContent = 'Erro na gravação';
      isRecording = false;
      break;
  }
}

// Escuta mensagens da extensão
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Meet content script recebeu mensagem:", message);
  
  if (message.action === "updateStatus") {
    updateStatus(message.status);
    sendResponse({success: true});
  }
  return true;
});

// Verifica se estamos no Google Meet
if (window.location.hostname.includes('meet.google.com')) {
  console.log("Detectado Google Meet, inicializando elementos visuais");
  setTimeout(() => {
    createStatusIndicator();
  }, 2000); // Aguarda um pouco para o Meet carregar completamente
} 