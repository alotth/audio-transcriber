// Função para carregar e exibir as gravações e transcrições
async function loadRecordings() {
  try {
    // Busca as gravações do storage local
    const { recordings } = await chrome.storage.local.get(["recordings"]);

    // Busca status atual das transcrições do backend
    const response = await fetch("http://localhost:3000/transcriptions");
    const transcriptions = await response.json();

    const container = document.getElementById("recordings-container");
    if (!container) return;

    container.innerHTML = "";

    if (!recordings || recordings.length === 0) {
      container.innerHTML = "<p>Nenhuma gravação encontrada.</p>";
      return;
    }

    recordings.forEach((recording) => {
      const transcription = transcriptions.find(
        (t) => t.filename === recording.filename
      );
      const status = transcription?.status || "unknown";

      const card = document.createElement("div");
      card.className = "recording-card";

      card.innerHTML = `
        <div class="recording-info">
          <p><strong>Data:</strong> ${new Date(
            recording.date
          ).toLocaleString()}</p>
          <p><strong>Página:</strong> ${recording.pageTitle}</p>
          <p><strong>Status:</strong> <span class="status-${status}">${getStatusText(
        status
      )}</span></p>
          ${getTranscriptionContent(transcription)}
        </div>
      `;

      container.appendChild(card);
    });
  } catch (error) {
    console.error("Erro ao carregar gravações:", error);
  }
}

function getStatusText(status) {
  const statusMap = {
    pending: "⏳ Aguardando processamento",
    converting: "🔄 Convertendo arquivo",
    uploading: "⬆️ Enviando para transcrição",
    transcribing: "📝 Transcrevendo",
    completed: "✅ Concluído",
    error: "❌ Erro",
    unknown: "❓ Status desconhecido",
  };
  return statusMap[status] || status;
}

function getStatusMessage(status) {
  const messageMap = {
    uploading: "Enviando arquivo para processamento...",
    transcribing: "Gerando transcrição...",
    completed: "Transcrição concluída",
    error: "Erro ao processar arquivo",
  };
  return messageMap[status] || "Status desconhecido";
}

function getTranscriptionContent(transcription) {
  if (!transcription) return "";

  switch (transcription.status) {
    case "completed":
      return `
        <div class="transcription">
          <h3>Transcrição:</h3>
          <p>${transcription.text}</p>
          ${
            transcription.speakers?.length
              ? `
            <h4>Falantes:</h4>
            ${transcription.speakers
              .map(
                (s) => `
              <p><strong>Falante ${s.speaker}:</strong> ${s.text}</p>
            `
              )
              .join("")}
          `
              : ""
          }
          ${
            transcription.details_file
              ? `
            <button onclick="showTranscriptionDetails('${transcription.id}')">
              Ver Detalhes Completos
            </button>
          `
              : ""
          }
        </div>
      `;
    case "error":
      return `
        <div class="error-message">
          <p>Erro: ${transcription.error}</p>
        </div>
      `;
    default:
      return `
        <div class="status-message">
          <p>${getStatusMessage(transcription.status)}</p>
        </div>
      `;
  }
}

// Função para exportar a transcrição
function exportTranscription(recording, transcription) {
  // Adiciona BOM para garantir que o arquivo seja reconhecido como UTF-8
  const BOM = "\uFEFF";
  let content = BOM;

  content += `Transcrição da Reunião\n`;
  content += `===================\n\n`;
  content += `Data: ${new Date(recording.date).toLocaleString()}\n`;
  content += `Página: ${recording.pageTitle}\n`;
  content += `URL: ${recording.pageUrl}\n\n`;

  if (transcription.speakers && transcription.speakers.length > 0) {
    transcription.speakers.forEach((utterance) => {
      content += `[Falante ${utterance.speaker}]: ${utterance.text}\n`;
    });
  } else {
    content += transcription.transcription;
  }

  // Cria um blob com o conteúdo especificando UTF-8
  const blob = new Blob([content], {
    type: "text/plain;charset=utf-8",
  });

  // Gera nome do arquivo
  const filename = `transcricao-${
    new Date(recording.date).toISOString().split("T")[0]
  }.txt`;

  // Cria link para download
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  // Limpa a URL criada
  URL.revokeObjectURL(url);
}

// Atualiza a lista quando houver mudanças
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.recordings) {
    loadRecordings();
  }
});

// Carrega as gravações quando a página é aberta
document.addEventListener("DOMContentLoaded", loadRecordings);

// Atualiza a cada 5 segundos
setInterval(loadRecordings, 5000);

// Adiciona função para mostrar detalhes
async function showTranscriptionDetails(transcriptionId) {
  try {
    const response = await fetch(
      `http://localhost:3000/transcription/${transcriptionId}/details`
    );
    const details = await response.json();

    // Cria um modal ou nova janela com os detalhes
    const detailsWindow = window.open(
      "",
      "Detalhes da Transcrição",
      "width=800,height=600"
    );
    detailsWindow.document.write(`
      <html>
        <head>
          <title>Detalhes da Transcrição</title>
          <style>
            body { font-family: Arial; padding: 20px; }
            pre { background: #f5f5f5; padding: 10px; }
          </style>
        </head>
        <body>
          <h2>Detalhes da Transcrição</h2>
          <p><strong>Duração:</strong> ${(details.audio_duration / 60).toFixed(
            2
          )} minutos</p>
          <p><strong>Confiança:</strong> ${(details.confidence * 100).toFixed(
            2
          )}%</p>
          <p><strong>Modelo:</strong> ${details.acoustic_model}</p>
          <p><strong>Criado em:</strong> ${new Date(
            details.created
          ).toLocaleString()}</p>
          <p><strong>Concluído em:</strong> ${new Date(
            details.completed
          ).toLocaleString()}</p>
          <h3>Texto Completo:</h3>
          <pre>${details.text}</pre>
          <h3>Palavras:</h3>
          <pre>${JSON.stringify(details.words, null, 2)}</pre>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Erro ao carregar detalhes:", error);
  }
}
