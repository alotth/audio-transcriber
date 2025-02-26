let isRecording = false;
let timer;
let startTime;

document.addEventListener("DOMContentLoaded", function () {
  // Verificar se está gravando
  chrome.storage.local.get(["isRecording"], function (result) {
    if (result.isRecording) {
      // Atualizar UI para mostrar que está gravando
      document.getElementById("startRecording").textContent = "Parar Gravação";
      document.getElementById("recordingStatus").textContent = "Gravando...";
      // Outras atualizações de UI necessárias
    }
  });
});

document
  .getElementById("startRecording")
  .addEventListener("click", async () => {
    const startButton = document.getElementById("startRecording");
    const stopButton = document.getElementById("stopRecording");

    startButton.disabled = true;
    stopButton.disabled = false;
    isRecording = true;

    startTime = Date.now();
    timer = setInterval(updateTimer, 1000);

    chrome.runtime.sendMessage({ action: "startRecording" });
    updateStatus("Gravando...");
  });

document.getElementById("stopRecording").addEventListener("click", () => {
  const startButton = document.getElementById("startRecording");
  const stopButton = document.getElementById("stopRecording");

  startButton.disabled = false;
  stopButton.disabled = true;
  isRecording = false;

  clearInterval(timer);
  chrome.runtime.sendMessage({ action: "stopRecording" });
  updateStatus("Gravação finalizada");
});

document.getElementById("viewTranscriptions").addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("transcriptions.html"),
  });
});

function updateTimer() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  document.getElementById("timer").textContent = `${pad(hours)}:${pad(
    minutes
  )}:${pad(seconds)}`;
}

function pad(num) {
  return num.toString().padStart(2, "0");
}

function updateStatus(message) {
  document.getElementById("status").textContent = message;
}
