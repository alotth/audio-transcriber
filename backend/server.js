const express = require("express");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const winston = require("winston");
const diskusage = require("diskusage");
const { v4: uuidv4 } = require("uuid");
const db = require("./db");
require("dotenv").config();

// Add request logging middleware
const app = express();
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Initialize the database asynchronously
(async function () {
  try {
    await db.initDatabase();
    console.log("Database initialized successfully");
  } catch (err) {
    console.error("Failed to initialize database:", err);
  }
})();

app.use(
  cors({
    origin: "*", // In development, allow all origins
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());

// Cria diretório de uploads se não existir
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Adicione no topo do arquivo, após as importações
const pendingTranscriptions = new Map(); // Para transcrições em andamento
const completedTranscriptions = new Map(); // Para transcrições finalizadas

// Configuração do logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    // Log de erros em arquivo separado
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Log geral
    new winston.transports.File({
      filename: "logs/combined.log",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Console em desenvolvimento
    ...(process.env.NODE_ENV !== "production"
      ? [
          new winston.transports.Console({
            format: winston.format.combine(
              winston.format.colorize(),
              winston.format.simple()
            ),
          }),
        ]
      : []),
  ],
});

// Cria diretório de logs se não existir
const logsDir = path.join(__dirname, "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Atualiza o middleware de upload para aceitar mais formatos
const upload = multer({
  storage: multer.diskStorage({
    destination: "uploads/",
    filename: (req, file, cb) => {
      cb(null, Date.now() + path.extname(file.originalname));
    },
  }),
  fileFilter: (req, file, cb) => {
    // Lista expandida de tipos MIME aceitos
    const allowedMimes = [
      "audio/webm",
      "audio/mp3",
      "audio/mpeg",
      "audio/wav",
      "audio/ogg",
      "audio/m4a",
      "audio/aac",
      "audio/x-m4a",
      "audio/mp4",
      "video/webm", // para arquivos webm com áudio
      "application/ogg",
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error("Formato não suportado. Use: WebM, MP3, WAV, OGG, M4A, AAC")
      );
    }
  },
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
});

function checkDiskSpace() {
  const free = diskusage.checkSync("/").free;
  const minFree = 500 * 1024 * 1024; // 500MB
  return free > minFree;
}

// Atualiza a rota de upload
app.post("/upload", upload.single("audio"), async (req, res) => {
  try {
    // Verificar espaço em disco antes de processar o upload
    if (!checkDiskSpace()) {
      logger.error("Espaço em disco insuficiente");
      return res.status(500).json({ error: "Sem espaço em disco suficiente" });
    }

    if (!req.file) {
      logger.warn("Upload sem arquivo recebido");
      throw new Error("Nenhum arquivo recebido");
    }

    logger.info("Arquivo recebido", {
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });

    const processedPath = await processAudio(req.file.path);
    logger.info("Áudio processado com sucesso", { processedPath });

    const transcript = await transcribeAudio(
      processedPath,
      req.file.originalname
    );
    logger.info("Transcrição concluída", {
      transcriptionId: transcript.transcriptionId,
      processedPath,
    });

    // Modificação aqui: retorna o ID da transcrição no formato que o cliente espera
    res.json(transcript);
  } catch (error) {
    logger.error("Erro no processamento do upload", {
      error: error.message,
      stack: error.stack,
      file: req.file,
    });
    res.status(500).json({ error: error.message });
  }
});

// Função para processar a fila de transcrições
async function processTranscriptionQueue() {
  for (const [transcriptionId, data] of pendingTranscriptions.entries()) {
    if (data.status === "pending") {
      try {
        console.log(`Processando transcrição ${transcriptionId}...`);

        // Atualiza status
        pendingTranscriptions.set(transcriptionId, {
          ...data,
          status: "uploading",
        });

        // Envia para AssemblyAI
        const assemblyResponse = await sendToAssemblyAI(data.filepath);

        // Atualiza com ID do AssemblyAI
        pendingTranscriptions.set(transcriptionId, {
          ...data,
          status: "transcribing",
          assemblyai_id: assemblyResponse.id,
        });

        // Inicia polling do status
        pollTranscriptionStatus(transcriptionId, assemblyResponse.id);
      } catch (error) {
        console.error(
          `Erro ao processar transcrição ${transcriptionId}:`,
          error
        );
        pendingTranscriptions.set(transcriptionId, {
          ...data,
          status: "error",
          error: error.message,
        });
      }
    }
  }
}

// Function to verify status of the transcription periodically
function pollTranscriptionStatus(transcriptionId, assemblyaiId) {
  const interval = setInterval(async () => {
    try {
      const status = await checkTranscriptionStatus(assemblyaiId);

      if (status.status === "completed") {
        clearInterval(interval);

        // Simplifica o objeto removendo palavras e utterances
        const transcriptionData = {
          id: transcriptionId,
          text: status.text,
          status: "completed",
          created_at: status.created,
          completed_at: status.completed,
          speaker_count: status.speaker_count || 0,
          // Adiciona apenas o texto formatado com identificação de falantes
          formatted_text: formatTextWithSpeakers(status),
        };

        // Usa caminho absoluto para salvar o arquivo
        const filename = path.join(
          __dirname,
          "transcriptions",
          `transcription-${transcriptionId}.json`
        );

        // Garante que o diretório existe
        if (!fs.existsSync(path.dirname(filename))) {
          fs.mkdirSync(path.dirname(filename), { recursive: true });
        }

        // Salva o arquivo com caminho absoluto
        fs.writeFileSync(filename, JSON.stringify(transcriptionData, null, 2));
        logger.info(`Transcription saved to ${filename}`);

        // Move para completedTranscriptions
        completedTranscriptions.set(transcriptionId, transcriptionData);
        pendingTranscriptions.delete(transcriptionId);

        // Limpa o arquivo de áudio
        const pendingData = pendingTranscriptions.get(transcriptionId);
        if (pendingData?.filepath) {
          fs.unlinkSync(pendingData.filepath);
        }
      } else if (status.status === "error") {
        clearInterval(interval);
        pendingTranscriptions.set(transcriptionId, {
          ...pendingTranscriptions.get(transcriptionId),
          status: "error",
          error: status.error,
        });
      }
    } catch (error) {
      console.error(
        `Erro ao verificar status da transcrição ${transcriptionId}:`,
        error
      );
      clearInterval(interval);
    }
  }, 5000);
}

// Função auxiliar para formatar o texto com identificadores de falantes
function formatTextWithSpeakers(transcriptionData) {
  if (
    !transcriptionData.utterances ||
    transcriptionData.utterances.length === 0
  ) {
    return transcriptionData.text; // Retorna o texto original se não houver informações de utterances
  }

  let formattedText = "";

  // Organiza as declarações por falante
  transcriptionData.utterances.forEach((utterance) => {
    formattedText += `[Falante ${utterance.speaker}]: ${utterance.text}\n\n`;
  });

  return formattedText;
}

// Nova rota para listar transcrições completas
app.get("/transcriptions", (req, res) => {
  try {
    const transcriptionsDir = path.join(__dirname, "transcriptions");

    if (!fs.existsSync(transcriptionsDir)) {
      return res.json({ transcriptions: [] });
    }

    const files = fs
      .readdirSync(transcriptionsDir)
      .filter((file) => file.endsWith(".json"));

    const transcriptions = files.map((file) => {
      try {
        const filePath = path.join(transcriptionsDir, file);
        const content = fs.readFileSync(filePath, "utf8");
        const data = JSON.parse(content);

        // Return just the basic info to keep the response lightweight
        return {
          id: data.id,
          fileName: file,
          text: data.text
            ? data.text.substring(0, 100) +
              (data.text.length > 100 ? "..." : "")
            : "",
          status: data.status,
          created_at:
            data.created_at ||
            new Date(fs.statSync(filePath).mtime).toISOString(),
        };
      } catch (error) {
        logger.error(`Error reading transcription file ${file}:`, error);
        return {
          fileName: file,
          error: error.message,
        };
      }
    });

    res.json({ transcriptions });
  } catch (error) {
    logger.error("Error getting transcriptions:", error);
    res.status(500).json({ error: error.message });
  }
});

// Explicitly define the /transcriptions/all endpoint FIRST
app.get("/transcriptions/all", async (req, res) => {
  try {
    logger.info("Request received to fetch all transcriptions");

    // Get all transcriptions from the database (metadata only)
    const allTranscriptions = await db.getAllTranscriptions();

    // Map the results to include file availability but don't load all files
    const mappedTranscriptions = allTranscriptions.map((item) => {
      // Check if transcription file exists, but don't load it
      if (item.status === "completed" && item.transcription_file) {
        const filePath = path.join(
          __dirname,
          "transcriptions",
          item.transcription_file
        );
        item.has_text = fs.existsSync(filePath);

        // Only load from file if we don't have formatted_text already
        if (item.has_text && !item.formatted_text) {
          try {
            const content = fs.readFileSync(filePath, "utf8");
            item.text_preview =
              content.substring(0, 100) + (content.length > 100 ? "..." : "");
          } catch (err) {
            console.warn(
              `Error reading preview from ${filePath}: ${err.message}`
            );
            item.text_preview = "Preview unavailable";
          }
        }
        // If we have formatted_text, use it for preview
        else if (item.formatted_text) {
          item.text_preview =
            item.formatted_text.substring(0, 100) +
            (item.formatted_text.length > 100 ? "..." : "");
        }
      }
      return item;
    });

    return res.json({
      transcriptions: mappedTranscriptions,
      count: mappedTranscriptions.length,
    });
  } catch (error) {
    logger.error("Error fetching all transcriptions:", error);
    return res.status(500).json({ error: "Failed to fetch transcriptions" });
  }
});

// Then define the specific ID endpoint AFTER
app.get("/transcriptions/:id", async (req, res) => {
  try {
    const id = req.params.id;
    // Get the transcription metadata from the database
    const transcription = await db.getTranscription(id);

    if (transcription) {
      // If the transcription is completed and has a file, load the text content
      if (
        transcription.status === "completed" &&
        transcription.transcription_file
      ) {
        const transcriptionPath = path.join(
          __dirname,
          "transcriptions",
          transcription.transcription_file
        );

        if (fs.existsSync(transcriptionPath)) {
          // Load the text from the file
          const transcriptionText = fs.readFileSync(transcriptionPath, "utf8");

          // Add the text to the response
          transcription.text = transcriptionText;
        } else {
          console.warn(`Transcription file not found: ${transcriptionPath}`);
        }
      }

      return res.json(transcription);
    }

    return res.status(404).json({ error: "Transcription not found" });
  } catch (error) {
    logger.error("Error fetching transcription:", error);
    return res.status(500).json({ error: "Failed to fetch transcription" });
  }
});

// Fix sendToAssemblyAI function to ensure it returns a valid upload_url
async function sendToAssemblyAI(filePath) {
  try {
    console.log(`Enviando arquivo para AssemblyAI: ${filePath}`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Arquivo não encontrado: ${filePath}`);
    }

    // Read the file as a buffer
    const fileData = fs.readFileSync(filePath);

    // Upload to AssemblyAI
    const uploadResponse = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: {
        authorization: process.env.ASSEMBLYAI_API_KEY,
        "content-type": "application/octet-stream",
      },
      body: fileData,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Erro no upload: ${errorText}`);
    }

    const uploadResult = await uploadResponse.json();
    console.log(`Upload concluído. URL: ${uploadResult.upload_url}`);

    if (!uploadResult.upload_url) {
      throw new Error("API não retornou URL de upload válida");
    }

    return uploadResult;
  } catch (error) {
    console.error(`Erro no upload do arquivo: ${error.message}`);
    throw error;
  }
}

// Atualiza a função checkTranscriptionStatus para incluir mais logs
async function checkTranscriptionStatus(assemblyAiId) {
  try {
    const response = await fetch(
      `https://api.assemblyai.com/v2/transcript/${assemblyAiId}`,
      {
        method: "GET",
        headers: {
          authorization: process.env.ASSEMBLYAI_API_KEY,
          "content-type": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error(`Error checking transcription status: ${error.message}`);
    throw error;
  }
}

// Atualiza a rota de detalhes para usar o arquivo salvo por pollTranscriptionStatus
app.get("/transcription/:id/details", async (req, res) => {
  try {
    const transcriptionId = req.params.id;
    // Usa o mesmo caminho absoluto que foi usado para salvar
    const filename = path.join(
      __dirname,
      "transcriptions",
      `transcription-${transcriptionId}.json`
    );

    logger.info(`Buscando arquivo de transcrição em: ${filename}`);

    if (fs.existsSync(filename)) {
      const details = JSON.parse(fs.readFileSync(filename, "utf8"));
      res.json(details);
    } else {
      logger.warn(`Arquivo de transcrição não encontrado: ${filename}`);
      res.status(404).json({ error: "Arquivo de transcrição não encontrado" });
    }
  } catch (error) {
    logger.error(`Erro ao buscar arquivo de transcrição: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Cria o diretório de transcrições se não existir
const transcriptionsDir = path.join(__dirname, "transcriptions");
if (!fs.existsSync(transcriptionsDir)) {
  fs.mkdirSync(transcriptionsDir);
}

// Adicione esta nova rota para verificar o status do sistema de transcrições
app.get("/transcription-system/status", (req, res) => {
  try {
    // Verificar diretórios
    const transcriptionsDir = path.join(__dirname, "transcriptions");
    const uploadsDir = path.join(__dirname, "uploads");

    const status = {
      transcriptionsDir: {
        path: transcriptionsDir,
        exists: fs.existsSync(transcriptionsDir),
        isWritable: false,
      },
      uploadsDir: {
        path: uploadsDir,
        exists: fs.existsSync(uploadsDir),
        isWritable: false,
      },
      pendingTranscriptions: Array.from(pendingTranscriptions.keys()),
      completedTranscriptions: Array.from(completedTranscriptions.keys()),
      diskSpace: {
        free: diskusage.checkSync("/").free,
        total: diskusage.checkSync("/").total,
      },
      nodeEnvironment: process.env.NODE_ENV || "production",
    };

    // Verificar permissões de escrita
    if (status.transcriptionsDir.exists) {
      try {
        const testFile = path.join(transcriptionsDir, "test-write.tmp");
        fs.writeFileSync(testFile, "test");
        fs.unlinkSync(testFile);
        status.transcriptionsDir.isWritable = true;
      } catch (e) {
        status.transcriptionsDir.error = e.message;
      }
    }

    if (status.uploadsDir.exists) {
      try {
        const testFile = path.join(uploadsDir, "test-write.tmp");
        fs.writeFileSync(testFile, "test");
        fs.unlinkSync(testFile);
        status.uploadsDir.isWritable = true;
      } catch (e) {
        status.uploadsDir.error = e.message;
      }
    }

    // Listar arquivos nas pastas
    status.transcriptionFiles = fs.existsSync(transcriptionsDir)
      ? fs.readdirSync(transcriptionsDir).filter((f) => f.endsWith(".json"))
      : [];

    status.uploadFiles = fs.existsSync(uploadsDir)
      ? fs.readdirSync(uploadsDir)
      : [];

    logger.info("Status do sistema de transcrições verificado", status);
    res.json(status);
  } catch (error) {
    logger.error("Erro ao verificar status do sistema", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: error.message });
  }
});

// Debug function to list all files in important directories
function listAllFiles() {
  try {
    const dirs = [
      { name: "Uploads", path: path.join(__dirname, "uploads") },
      { name: "Transcriptions", path: path.join(__dirname, "transcriptions") },
    ];

    dirs.forEach((dir) => {
      if (!fs.existsSync(dir.path)) {
        logger.warn(`Directory ${dir.name} does not exist: ${dir.path}`);
        return;
      }

      const files = fs.readdirSync(dir.path);
      logger.info(
        `${dir.name} directory (${dir.path}) contains ${files.length} files:`
      );
      files.forEach((file) => {
        const filePath = path.join(dir.path, file);
        const stats = fs.statSync(filePath);
        logger.info(
          `- ${file} (${stats.size} bytes, modified: ${stats.mtime})`
        );
      });
    });

    // List in-memory transcriptions
    logger.info(
      `Pending transcriptions in memory: ${pendingTranscriptions.size}`
    );
    pendingTranscriptions.forEach((value, key) => {
      logger.info(`- Pending: ${key}, status: ${value.status}`);
    });

    logger.info(
      `Completed transcriptions in memory: ${completedTranscriptions.size}`
    );
    completedTranscriptions.forEach((value, key) => {
      logger.info(`- Completed: ${key}`);
    });
  } catch (error) {
    logger.error("Error listing files:", error);
  }
}

// Run this debug function every 5 minutes and at startup
setInterval(listAllFiles, 5 * 60 * 1000);
listAllFiles();

// Add this to test file writing capabilities
app.get("/test-write", (req, res) => {
  try {
    const transcriptionsDir = path.join(__dirname, "transcriptions");
    const testFile = path.join(transcriptionsDir, `test-${Date.now()}.json`);

    // Ensure directory exists
    if (!fs.existsSync(transcriptionsDir)) {
      fs.mkdirSync(transcriptionsDir, { recursive: true });
      logger.info(`Created transcriptions directory: ${transcriptionsDir}`);
    }

    // Try to write test file
    fs.writeFileSync(
      testFile,
      JSON.stringify({ test: "data", timestamp: new Date() }, null, 2)
    );
    logger.info(`Successfully wrote test file: ${testFile}`);

    res.json({
      success: true,
      message: "Test file written successfully",
      path: testFile,
      dir: {
        path: transcriptionsDir,
        exists: fs.existsSync(transcriptionsDir),
        isDirectory: fs.statSync(transcriptionsDir).isDirectory(),
        permissions: fs.statSync(transcriptionsDir).mode.toString(8),
      },
    });
  } catch (error) {
    logger.error(`Error writing test file: ${error.message}`, {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Run this at startup to ensure all directories are properly created with correct permissions
function ensureDirectories() {
  const dirs = [
    path.join(__dirname, "uploads"),
    path.join(__dirname, "transcriptions"),
    path.join(__dirname, "logs"),
  ];

  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
        logger.info(`Created directory: ${dir}`);
      } catch (error) {
        logger.error(`Failed to create directory ${dir}: ${error.message}`);
      }
    }
  });
}

// Call this function at startup
ensureDirectories();

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

async function processAudio(inputPath) {
  const fileFormat = path.extname(inputPath).toLowerCase().slice(1);
  const acceptedFormats = ["mp3", "mp4", "wav", "ogg", "m4a", "webm"];

  logger.info("Iniciando processamento de áudio", {
    inputPath,
    fileFormat,
    fileSize: fs.statSync(inputPath).size,
  });

  if (acceptedFormats.includes(fileFormat)) {
    logger.info("Formato já aceito, pulando conversão", { fileFormat });
    return inputPath;
  }

  const outputPath = inputPath.replace(/\.[^/.]+$/, ".webm");

  return new Promise((resolve, reject) => {
    logger.info("Iniciando conversão de áudio", {
      from: fileFormat,
      to: "webm",
      inputPath,
      outputPath,
    });

    ffmpeg(inputPath)
      .toFormat("webm")
      .audioCodec("libopus")
      .on("start", (command) => {
        logger.info("Comando ffmpeg iniciado", { command });
      })
      .on("progress", (progress) => {
        logger.debug("Progresso da conversão", { progress });
      })
      .on("end", () => {
        logger.info("Conversão finalizada com sucesso", { outputPath });
        fs.unlink(inputPath, (err) => {
          if (err) {
            logger.error("Erro ao deletar arquivo original", {
              error: err.message,
              inputPath,
            });
          }
        });
        resolve(outputPath);
      })
      .on("error", (err) => {
        logger.error("Erro na conversão de áudio", {
          error: err.message,
          inputPath,
          outputPath,
        });
        reject(new Error(`Erro na conversão: ${err.message}`));
      })
      .save(outputPath);
  });
}

async function createTranscription(audioUrl) {
  console.log("Creating transcription for uploaded audio URL:", audioUrl);

  const options = {
    method: "POST",
    headers: {
      authorization: process.env.ASSEMBLYAI_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      language_code: "pt", // Set to Portuguese
    }),
  };

  try {
    const response = await fetch(
      "https://api.assemblyai.com/v2/transcript",
      options
    );

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();
    console.log("Transcription initiated with ID:", data.id);
    return data;
  } catch (error) {
    console.error("Error creating transcription:", error.message);
    throw new Error(`Failed to create transcription: ${error.message}`);
  }
}

async function transcribeAudio(audioPath, originalFilename) {
  try {
    console.log(`Iniciando transcrição para arquivo: ${audioPath}`);

    // Extract timestamp from the original filename
    let transcriptionId;
    const timestampMatch =
      originalFilename && originalFilename.match(/recording-(.+)\.webm/);

    if (timestampMatch && timestampMatch[1]) {
      // Use timestamp from filename, replacing colons and other special characters
      const timestamp = timestampMatch[1].replace(/:/g, "-");
      transcriptionId = timestamp;
      console.log(
        `Using timestamp from filename for transcription ID: ${transcriptionId}`
      );
    } else {
      // Generate a UUID if timestamp not available
      transcriptionId = uuidv4();
      console.log(`Generated UUID for transcription ID: ${transcriptionId}`);
    }

    // Upload audio to AssemblyAI
    const uploadResult = await sendToAssemblyAI(audioPath);

    if (!uploadResult || !uploadResult.upload_url) {
      throw new Error("Failed to get upload URL from AssemblyAI");
    }

    console.log(
      `Successfully uploaded audio. Using URL: ${uploadResult.upload_url}`
    );

    // Create transcription in AssemblyAI
    const transcriptionResponse = await createTranscription(
      uploadResult.upload_url
    );

    if (!transcriptionResponse || !transcriptionResponse.id) {
      throw new Error("Failed to create transcription job");
    }

    // Log the AssemblyAI transcription ID
    console.log(
      `Transcription job created with AssemblyAI ID: ${transcriptionResponse.id}`
    );

    // Create and save the transcription data
    const transcriptionData = {
      id: transcriptionId,
      assemblyAiId: transcriptionResponse.id,
      status: "processing",
      audioFile: audioPath,
      audioFilename: path.basename(audioPath),
      originalFilename: originalFilename,
      created_at: new Date().toISOString(),
    };

    // Save to database
    await db.addPendingTranscription(transcriptionData);
    console.log(`Saved pending transcription to database: ${transcriptionId}`);

    // Start polling for this transcription
    startPollingForTranscription(transcriptionId, transcriptionResponse.id);

    // Return the transcription ID so the client can check status
    return {
      transcriptionId: transcriptionId,
      status: "processing",
    };
  } catch (error) {
    console.error("Erro na função transcribeAudio:", error);
    throw error;
  }
}

// Update your function for processing completed transcriptions
function processCompletedTranscription(transcription, assemblyResponse) {
  // The transcription.id should already be the timestamp-based ID
  const transcriptionId = transcription.id;
  const assemblyAiId = transcription.assemblyAiId;

  // Create the transcription result data
  const transcriptionData = {
    id: transcriptionId,
    assemblyAiId: assemblyAiId,
    text: assemblyResponse.text,
    status: "completed",
    speaker_count: assemblyResponse.speaker_count || 0,
    formatted_text: formatTranscription(assemblyResponse),
    created_at: transcription.created_at,
    completed_at: new Date().toISOString(),
    audioFilename: transcription.audioFilename,
    originalFilename: transcription.originalFilename,
  };

  // Save to the transcriptions directory with the timestamp-based name
  const transcriptionsPath = path.join(__dirname, "transcriptions");
  if (!fs.existsSync(transcriptionsPath)) {
    fs.mkdirSync(transcriptionsPath, { recursive: true });
  }

  const transcriptionPath = path.join(
    transcriptionsPath,
    `transcription-${transcriptionId}.json`
  );

  fs.writeFileSync(
    transcriptionPath,
    JSON.stringify(transcriptionData, null, 2)
  );
  console.log(`Saved completed transcription to: ${transcriptionPath}`);

  // Update the in-memory maps
  completedTranscriptions.set(transcriptionId, transcriptionData);
  pendingTranscriptions.delete(transcriptionId);

  return transcriptionData;
}

// Add this function to poll for transcription completion
function startPollingForTranscription(
  transcriptionId,
  assemblyAiId,
  intervalMs = 5000
) {
  console.log(
    `Starting polling for transcription: ${transcriptionId} (AssemblyAI ID: ${assemblyAiId})`
  );

  // Store the interval ID so we can clear it later
  const intervalId = setInterval(async () => {
    try {
      // Get the current transcription status from the database
      const transcription = await db.getTranscription(transcriptionId);

      // Skip if transcription doesn't exist or is already completed
      if (!transcription || transcription.status !== "processing") {
        clearInterval(intervalId);
        return;
      }

      console.log(`Checking status for transcription: ${transcriptionId}`);
      const statusResponse = await checkTranscriptionStatus(assemblyAiId);

      if (statusResponse.status === "completed") {
        console.log(`Transcription ${transcriptionId} is complete!`);

        // Save the completed transcription to database
        await db.completeTranscription(transcriptionId, statusResponse);

        // Clean up by clearing the interval
        clearInterval(intervalId);

        // Emit an event or log completion
        console.log(`Transcription ${transcriptionId} saved successfully`);
      } else if (statusResponse.status === "error") {
        console.error(
          `Transcription ${transcriptionId} failed: ${statusResponse.error}`
        );

        // Update the status in the database
        await db.updateTranscriptionStatus(
          transcriptionId,
          "error",
          statusResponse.error
        );

        clearInterval(intervalId);
      } else {
        console.log(
          `Transcription ${transcriptionId} status: ${statusResponse.status}`
        );
      }
    } catch (error) {
      console.error(`Error polling transcription ${transcriptionId}:`, error);
    }
  }, intervalMs);

  // Store the interval ID
  return intervalId;
}

// Add a function to format transcription text nicely
function formatTranscription(transcriptionData) {
  // Basic formatting - you can enhance this based on your needs
  if (
    !transcriptionData.utterances ||
    transcriptionData.utterances.length === 0
  ) {
    return transcriptionData.text || "No transcription text available";
  }

  // Format with speaker labels if available
  let formattedText = "";
  let currentSpeaker = null;

  transcriptionData.utterances.forEach((utterance) => {
    if (utterance.speaker !== currentSpeaker) {
      currentSpeaker = utterance.speaker;
      formattedText += `\nSpeaker ${currentSpeaker}: `;
    }

    formattedText += utterance.text + " ";
  });

  return formattedText.trim();
}

// Add a new endpoint to download the transcription file
app.get("/transcriptions/:id/download", async (req, res) => {
  try {
    const id = req.params.id;
    const transcription = await db.getTranscription(id);

    if (
      !transcription ||
      transcription.status !== "completed" ||
      !transcription.transcription_file
    ) {
      return res.status(404).json({ error: "Transcription file not found" });
    }

    const transcriptionPath = path.join(
      __dirname,
      "transcriptions",
      transcription.transcription_file
    );

    if (!fs.existsSync(transcriptionPath)) {
      return res.status(404).json({ error: "Transcription file not found" });
    }

    // Set headers for file download
    res.setHeader("Content-Type", "text/plain");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${transcription.transcription_file}`
    );

    // Send the file as a download
    res.sendFile(transcriptionPath);
  } catch (error) {
    logger.error("Error downloading transcription:", error);
    return res.status(500).json({ error: "Failed to download transcription" });
  }
});
