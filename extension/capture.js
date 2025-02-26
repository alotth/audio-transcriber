// Recebe o streamId do background script
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (request.action === "startCapture" && request.streamId) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: request.streamId
          }
        }
      });
      // Envia o stream de volta para o background script
      chrome.runtime.sendMessage({
        action: "streamReady",
        stream: stream
      });
    } catch (error) {
      chrome.runtime.sendMessage({
        action: "streamError",
        error: error.message
      });
    }
  }
});

// Atualiza o status na página
document.getElementById('status').textContent = 'Aguardando seleção da fonte de áudio...'; 