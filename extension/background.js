let audioChunks = [];
const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY; // Usando a chave do seu .env
let isRecording = false;

async function getTabStream() {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.capture(
      {
        audio: true,
        video: false,
      },
      (stream) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else if (stream) {
          resolve(stream);
        } else {
          reject(new Error("Não foi possível capturar o áudio da aba"));
        }
      }
    );
  });
}

async function getMicStream() {
  try {
    // Solicita acesso ao microfone diretamente via getUserMedia
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 48000,
        channelCount: 2,
      },
      video: false,
    });
  } catch (error) {
    console.error("Erro ao acessar microfone:", error);
    // Se o usuário negou acesso ou não há microfone, retornamos null
    // e a gravação continuará apenas com o áudio do sistema
    return null;
  }
}

function combineAudioStreams(tabStream, micStream) {
  try {
    const audioContext = new AudioContext();

    const tabSource = audioContext.createMediaStreamSource(tabStream);
    const micSource = micStream
      ? audioContext.createMediaStreamSource(micStream)
      : null;

    const destination = audioContext.createMediaStreamDestination();

    // Ajusta o volume do áudio da aba
    const tabGain = audioContext.createGain();
    tabGain.gain.value = 0.7; // Reduz um pouco o volume do sistema
    tabSource.connect(tabGain);
    tabGain.connect(destination);

    if (micSource) {
      // Ajusta o volume do microfone
      const micGain = audioContext.createGain();
      micGain.gain.value = 1.0; // Volume normal para o microfone
      micSource.connect(micGain);
      micGain.connect(destination);
    }

    return destination.stream;
  } catch (error) {
    console.error("Erro ao combinar streams:", error);
    // Se falhar a combinação, retorna apenas o stream da aba
    return tabStream;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "startRecording") {
    startRecording()
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        console.error("Erro ao iniciar gravação:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  } else if (request.action === "stopRecording") {
    stopRecording();
  } else if (request.action === "audioRecorded") {
    try {
      // Verificar se os dados base64 são válidos
      if (!request.audio || typeof request.audio !== "string") {
        console.error("Dados de áudio inválidos recebidos:", request.audio);
        sendResponse({ error: "Dados de áudio inválidos" });
        return true;
      }

      // Tentar converter base64 para Blob com tratamento de erro
      try {
        const binaryString = atob(request.audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const audioBlob = new Blob([bytes], {
          type: request.mimeType || "audio/webm",
        });

        console.log("Áudio recebido:", {
          size: audioBlob.size,
          type: audioBlob.type,
        });

        // Salva uma cópia para teste
        saveAudioForTesting(audioBlob);

        // Processa o áudio
        handleRecordedAudio(audioBlob);
      } catch (error) {
        console.error("Erro ao processar base64:", error);
        sendResponse({ error: "Falha ao processar dados de áudio" });
      }
    } catch (error) {
      console.error("Erro ao processar mensagem:", error);
      sendResponse({ error: error.message });
    }
  } else if (request.action === "recordingStarted") {
    isRecording = true;
    chrome.runtime.sendMessage({ action: "recordingStarted" });
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0] && tabs[0].url.includes("meet.google.com")) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: "updateStatus",
          status: "recording",
        });
      }
    });
  } else if (request.action === "recordingError") {
    console.error("Erro na gravação:", request.error);
  } else if (request.action === "openTranscriptions") {
    chrome.tabs.create({
      url: "/transcriptions.html",
    });
  }
  return true;
});

async function convertToWav(webmBlob) {
  return new Promise((resolve, reject) => {
    const fileReader = new FileReader();

    fileReader.onload = async function (event) {
      try {
        const audioContext = new (window.AudioContext ||
          window.webkitAudioContext)();
        const audioBuffer = await audioContext.decodeAudioData(
          event.target.result
        );

        const numberOfChannels = audioBuffer.numberOfChannels;
        const length = audioBuffer.length * numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const wavBuffer = new ArrayBuffer(44 + length * 2);
        const view = new DataView(wavBuffer);

        writeString(view, 0, "RIFF");
        view.setUint32(4, 36 + length * 2, true);
        writeString(view, 8, "WAVE");
        writeString(view, 12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numberOfChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 4, true);
        view.setUint16(32, numberOfChannels * 2, true);
        view.setUint16(34, 16, true);
        writeString(view, 36, "data");
        view.setUint32(40, length * 2, true);

        const channels = [];
        for (let i = 0; i < numberOfChannels; i++) {
          channels.push(audioBuffer.getChannelData(i));
        }

        let offset = 44;
        for (let i = 0; i < audioBuffer.length; i++) {
          for (let channel = 0; channel < numberOfChannels; channel++) {
            const sample = Math.max(-1, Math.min(1, channels[channel][i]));
            view.setInt16(
              offset,
              sample < 0 ? sample * 0x8000 : sample * 0x7fff,
              true
            );
            offset += 2;
          }
        }

        const wavBlob = new Blob([wavBuffer], { type: "audio/wav" });
        resolve(wavBlob);
      } catch (error) {
        reject(error);
      }
    };

    fileReader.onerror = reject;
    fileReader.readAsArrayBuffer(webmBlob);
  });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

async function checkFileExists(filename) {
  return new Promise((resolve) => {
    chrome.downloads.search(
      {
        filename: filename,
        state: "complete",
      },
      (downloads) => {
        resolve(downloads.length > 0);
      }
    );
  });
}

async function readDownloadedFile(filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.search(
      {
        filename: filename,
        state: "complete",
      },
      async (downloads) => {
        if (downloads.length === 0) {
          reject(new Error("Arquivo não encontrado"));
          return;
        }

        try {
          let attempts = 0;
          const maxAttempts = 3;

          while (attempts < maxAttempts) {
            try {
              const response = await fetch(downloads[0].filename);
              if (!response.ok) throw new Error(`HTTP ${response.status}`);

              const blob = await response.blob();
              if (blob.size === 0) throw new Error("Arquivo vazio");

              resolve(blob);
              return;
            } catch (error) {
              attempts++;
              if (attempts === maxAttempts) throw error;
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          }
        } catch (error) {
          reject(new Error(`Erro ao ler arquivo: ${error.message}`));
        }
      }
    );
  });
}

async function handleRecordedAudio(audioBlob) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `recording-${timestamp}.webm`;

    const metadata = {
      filename,
      date: new Date().toISOString(),
      pageTitle: "Gravação de Áudio",
      pageUrl: "Aba Atual",
      status: "uploading",
    };

    // Salva os metadados primeiro
    chrome.storage.local.get(["recordings"], function (result) {
      const recordings = result.recordings || [];
      recordings.push(metadata);
      chrome.storage.local.set({ recordings });
    });

    await sendForTranscription(audioBlob, metadata);
  } catch (error) {
    console.error("Erro ao processar gravação:", error);
    if (metadata) {
      updateRecordingStatus(metadata.filename, "error", error.message);
    }
  }
}

async function startTranscriptionAttempts(
  filename,
  metadata,
  maxAttempts = 10
) {
  let attempts = 0;
  const initialDelay = 10000;
  const retryDelay = 15000;

  async function attemptTranscription() {
    try {
      const exists = await checkFileExists(filename);
      if (!exists) {
        console.log(
          `Tentativa ${
            attempts + 1
          }: Arquivo ainda não salvo em Downloads. Próxima tentativa em ${
            retryDelay / 1000
          } segundos.`
        );
        if (attempts < maxAttempts) {
          attempts++;
          setTimeout(attemptTranscription, retryDelay);
        } else {
          console.error(
            "Máximo de tentativas atingido. Por favor, verifique se o arquivo foi salvo em Downloads e tente novamente."
          );
        }
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const audioBlob = await readDownloadedFile(filename);

      if (audioBlob.size === 0) {
        throw new Error("Arquivo vazio");
      }

      console.log(
        `Arquivo encontrado em Downloads. Tamanho: ${(
          audioBlob.size /
          1024 /
          1024
        ).toFixed(2)}MB`
      );

      await sendForTranscription(audioBlob, metadata);
      console.log("Transcrição iniciada com sucesso");
    } catch (error) {
      console.error("Erro na tentativa de transcrição:", error);
      if (attempts < maxAttempts) {
        attempts++;
        console.log(`Tentando novamente em ${retryDelay / 1000} segundos...`);
        setTimeout(attemptTranscription, retryDelay);
      } else {
        console.error("Máximo de tentativas atingido após erros.");
      }
    }
  }

  console.log(
    `Aguardando ${
      initialDelay / 1000
    } segundos antes de iniciar as tentativas de transcrição...`
  );
  setTimeout(attemptTranscription, initialDelay);
}

// Função para criar/obter a página offscreen
async function setupOffscreenDocument() {
  try {
    // Verifica se já existe uma página offscreen
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });

    if (existingContexts.length > 0) {
      console.log("Página offscreen já existe");
      return;
    }

    // Cria a página offscreen
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["TAB_CAPTURE"], // É importante usar TAB_CAPTURE
      justification: "Necessário para captura de áudio",
    });

    console.log("Página offscreen criada para captura de áudio");
  } catch (error) {
    console.error("Erro ao configurar offscreen document:", error);
    throw error;
  }
}

async function startRecording() {
  try {
    console.log("Iniciando gravação...");

    // Configurar a página offscreen
    await setupOffscreenDocument();

    // Obter a aba atual
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab) {
      throw new Error("Nenhuma aba ativa encontrada");
    }

    // Enviar o ID da aba para a página offscreen
    const response = await chrome.runtime.sendMessage({
      action: "captureTabAudio",
      tabId: tab.id,
    });

    if (!response || !response.success) {
      throw new Error(response?.error || "Erro ao iniciar gravação");
    }

    // Definir estado de gravação
    await chrome.storage.local.set({ isRecording: true });

    chrome.runtime.sendMessage({ action: "recordingStarted" });

    // Atualiza o status visual no Meet
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0] && tabs[0].url.includes("meet.google.com")) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: "updateStatus",
          status: "recording",
        });
      }
    });
  } catch (error) {
    console.error("Erro ao iniciar gravação:", error);
    chrome.runtime.sendMessage({
      action: "recordingError",
      error: error.message,
    });
    throw error;
  }
}

function stopRecording() {
  chrome.runtime.sendMessage({
    action: "stopRecording",
  });

  // Atualiza o estado
  chrome.storage.local.set({ isRecording: false });

  // Atualiza o status visual
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs[0] && tabs[0].url.includes("meet.google.com")) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: "updateStatus",
        status: "stopped",
      });
    }
  });
}

async function saveAudioFile(blob, filename) {
  try {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onloadend = () => {
        chrome.storage.local.set(
          {
            [filename]: reader.result,
          },
          () => {
            chrome.downloads.download(
              {
                url: reader.result,
                filename: filename,
                saveAs: false,
              },
              () => {
                resolve();
              }
            );
          }
        );
      };

      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error("Erro ao salvar arquivo:", error);
    throw error;
  }
}

async function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["assemblyaiApiKey"], (result) => {
      resolve(result.assemblyaiApiKey);
    });
  });
}

async function sendForTranscription(audioBlob, metadata) {
  try {
    console.log("Preparando envio do arquivo:", metadata.filename);
    console.log("Tamanho do arquivo:", audioBlob.size, "bytes");
    console.log("Tipo MIME:", audioBlob.type);

    if (audioBlob.size === 0) {
      throw new Error("Arquivo de áudio vazio");
    }

    const formData = new FormData();
    formData.append("audio", audioBlob, metadata.filename);

    console.log("Enviando para o backend...");
    const uploadResponse = await fetch("http://localhost:3000/upload", {
      method: "POST",
      body: formData,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(
        `Erro no upload: ${uploadResponse.status} - ${errorText}`
      );
    }

    const responseData = await uploadResponse.json();
    console.log("Resposta do backend:", responseData);

    const { transcriptionId } = responseData;
    updateRecordingStatus(metadata.filename, "transcribing", {
      transcriptionId,
    });

    startStatusPolling(transcriptionId, metadata.filename);
  } catch (error) {
    console.error("Erro:", error);
    updateRecordingStatus(metadata.filename, "error", error.message);
    throw error;
  }
}

function startStatusPolling(transcriptionId, filename) {
  const pollInterval = setInterval(async () => {
    try {
      const response = await fetch(
        `http://localhost:3000/transcription/${transcriptionId}`
      );
      const transcription = await response.json();

      if (transcription.status === "completed") {
        clearInterval(pollInterval);
        updateRecordingStatus(filename, "completed", {
          transcription: transcription.text,
          speakers: transcription.utterances || [],
        });
      } else if (transcription.status === "error") {
        clearInterval(pollInterval);
        updateRecordingStatus(filename, "error", transcription.error);
      }
    } catch (error) {
      console.error("Erro ao verificar status:", error);
    }
  }, 3000);
}

function updateRecordingStatus(filename, status, data = {}) {
  chrome.storage.local.get(["recordings"], function (result) {
    const recordings = result.recordings || [];
    const recordingIndex = recordings.findIndex((r) => r.filename === filename);

    if (recordingIndex !== -1) {
      recordings[recordingIndex] = {
        ...recordings[recordingIndex],
        status,
        ...data,
      };
      chrome.storage.local.set({ recordings });
    }
  });
}

async function uploadAudio(audioBlob) {
  try {
    const response = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/octet-stream",
      },
      body: audioBlob,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.upload_url;
  } catch (error) {
    console.error("Erro no upload:", error);
    return null;
  }
}

async function startTranscription(audioUrl) {
  try {
    const response = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        audio_url: audioUrl,
        language_code: "pt",
        speaker_labels: true,
        content_safety: true,
        encoding: "utf-8",
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const transcriptData = await response.json();
    const transcriptId = transcriptData.id;

    return await waitForTranscription(transcriptId);
  } catch (error) {
    console.error("Erro ao iniciar transcrição:", error);
    return null;
  }
}

async function waitForTranscription(transcriptId, apiKey) {
  try {
    while (true) {
      const response = await fetch(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        {
          headers: {
            Authorization: apiKey,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.status === "completed") {
        return data;
      } else if (data.status === "error") {
        throw new Error(`Erro na transcrição: ${data.error}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  } catch (error) {
    console.error("Erro ao verificar status:", error);
    return null;
  }
}

// Modifique a função saveAudioForTesting
function saveAudioForTesting(audioBlob) {
  // Converte o Blob para base64
  const reader = new FileReader();
  reader.onloadend = () => {
    const base64data = reader.result;

    // Usa chrome.downloads para salvar o arquivo
    chrome.downloads.download(
      {
        url: base64data,
        filename: "test-recording.webm",
        saveAs: false,
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error(
            "Erro ao salvar arquivo de teste:",
            chrome.runtime.lastError
          );
        } else {
          console.log("Arquivo de teste salvo com ID:", downloadId);
        }
      }
    );
  };
  reader.readAsDataURL(audioBlob);
}
