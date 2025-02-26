const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

// Ensure database directory exists
const dbDir = path.join(__dirname, "data");
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, "transcriptions.db");
let db;

// Initialize the database
function initDatabase() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error("Error opening database:", err);
        reject(err);
        return;
      }

      // Esquema atualizado - removendo campos de texto grandes
      db.run(
        `
        CREATE TABLE IF NOT EXISTS transcriptions (
          id TEXT PRIMARY KEY,
          assembly_ai_id TEXT,
          status TEXT NOT NULL,
          audio_file TEXT,
          audio_filename TEXT,
          original_filename TEXT,
          created_at TEXT NOT NULL,
          completed_at TEXT,
          speaker_count INTEGER DEFAULT 0,
          transcription_file TEXT,
          formatted_text TEXT,
          error TEXT
        )
      `,
        (err) => {
          if (err) {
            console.error("Error creating table:", err);
            reject(err);
            return;
          }
          console.log("Database initialized");
          resolve();
        }
      );
    });
  });
}

// Add a new pending transcription
function addPendingTranscription(transcription) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT INTO transcriptions (
        id, assembly_ai_id, status, audio_file, audio_filename, 
        original_filename, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      transcription.id,
      transcription.assemblyAiId,
      "processing",
      transcription.audioFile,
      transcription.audioFilename,
      transcription.originalFilename,
      transcription.created_at,
      function (err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(transcription);
      }
    );

    stmt.finalize();
  });
}

// Update a transcription status
function updateTranscriptionStatus(id, status, error = null) {
  return new Promise((resolve, reject) => {
    db.run(
      `
      UPDATE transcriptions 
      SET status = ?, error = ?
      WHERE id = ?
    `,
      [status, error, id],
      function (err) {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      }
    );
  });
}

// Complete a transcription with the response from AssemblyAI
function completeTranscription(id, assemblyResponse) {
  return new Promise((resolve, reject) => {
    // Format the transcription text with speaker labels
    const formattedText = formatTranscription(assemblyResponse);

    // Create transcriptions directory if it doesn't exist
    const transcriptionsDir = path.join(__dirname, "transcriptions");
    if (!fs.existsSync(transcriptionsDir)) {
      fs.mkdirSync(transcriptionsDir, { recursive: true });
    }

    // Save the formatted text to a file
    const transcriptionFilename = `transcription-${id}.txt`;
    const transcriptionPath = path.join(
      transcriptionsDir,
      transcriptionFilename
    );

    try {
      // Write the formatted text to the file
      fs.writeFileSync(transcriptionPath, formattedText, "utf8");
      console.log(`Transcription text saved to file: ${transcriptionPath}`);
    } catch (fileErr) {
      console.error(`Error saving transcription to file: ${fileErr.message}`);
      reject(fileErr);
      return;
    }

    // Limit the text size for database storage (e.g., 8000 characters)
    const MAX_DB_TEXT_LENGTH = 8000;
    const trimmedFormattedText =
      formattedText.length > MAX_DB_TEXT_LENGTH
        ? formattedText.substring(0, MAX_DB_TEXT_LENGTH) +
          "... (text truncated, see full file)"
        : formattedText;

    // Update the database with metadata and limited text
    db.run(
      `
      UPDATE transcriptions 
      SET 
        status = 'completed',
        completed_at = ?,
        speaker_count = ?,
        formatted_text = ?,
        transcription_file = ?
      WHERE id = ?
    `,
      [
        new Date().toISOString(),
        assemblyResponse.speaker_count || 0,
        trimmedFormattedText,
        transcriptionFilename,
        id,
      ],
      function (err) {
        if (err) {
          reject(err);
          return;
        }

        getTranscription(id).then(resolve).catch(reject);
      }
    );
  });
}

// Get a transcription by ID
function getTranscription(id) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM transcriptions WHERE id = ?", [id], (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });
}

// Get all transcriptions
function getAllTranscriptions() {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT * FROM transcriptions ORDER BY created_at DESC",
      (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      }
    );
  });
}

// Get all pending transcriptions
function getPendingTranscriptions() {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT * FROM transcriptions WHERE status = 'processing'",
      (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      }
    );
  });
}

// Get all completed transcriptions
function getCompletedTranscriptions() {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT * FROM transcriptions WHERE status = 'completed'",
      (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      }
    );
  });
}

// Format transcription with speaker labels
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

// Close the database connection (for cleanup)
function closeDatabase() {
  return new Promise((resolve, reject) => {
    if (db) {
      db.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    } else {
      resolve();
    }
  });
}

module.exports = {
  initDatabase,
  addPendingTranscription,
  updateTranscriptionStatus,
  completeTranscription,
  getTranscription,
  getAllTranscriptions,
  getPendingTranscriptions,
  getCompletedTranscriptions,
  closeDatabase,
};
