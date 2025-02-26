const { ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");
const { homedir } = require("os");
const { shell } = require("electron");

console.log("Renderer script loading...");

let mediaRecorder;
let recordedChunks = [];
let pollingIntervals = {}; // Store polling intervals by transcription ID
let audioContext;
let analyser;
let visualizerCanvas;
let canvasContext;
let visualizerText;
let animationId;
let dataArray;

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM fully loaded");

  const recordButton = document.getElementById("recordButton");
  const status = document.getElementById("status");
  const viewTranscriptionsButton = document.getElementById(
    "viewTranscriptionsButton"
  );

  // Initialize visualizer
  visualizerCanvas = document.getElementById("visualizer");
  visualizerText = document.getElementById("visualizerText");

  if (visualizerCanvas) {
    canvasContext = visualizerCanvas.getContext("2d");
    // Set canvas dimensions to match its display size
    visualizerCanvas.width = visualizerCanvas.offsetWidth;
    visualizerCanvas.height = visualizerCanvas.offsetHeight;
  }

  if (!recordButton) console.error("Record button not found!");
  if (!viewTranscriptionsButton)
    console.error("View transcriptions button not found!");

  // Now connect the event listeners
  if (recordButton) {
    recordButton.addEventListener("click", async () => {
      console.log("Record button clicked");
      try {
        if (mediaRecorder && mediaRecorder.state === "recording") {
          stopRecording();
        } else {
          await startRecording();
        }
      } catch (error) {
        console.error("Error handling record button:", error);
        status.textContent = `Error: ${error.message}`;
      }
    });
  }

  if (viewTranscriptionsButton) {
    viewTranscriptionsButton.addEventListener("click", () => {
      console.log("View transcriptions button clicked");
      window.location.href = "transcriptions.html";
    });
  }

  // Add these DOM elements at the top with the others
  const uploadButton = document.getElementById("uploadButton");
  const fileUploadInput = document.getElementById("fileUploadInput");
  const uploadStatus = document.getElementById("uploadStatus");

  // Add event listeners for upload
  if (uploadButton) {
    uploadButton.addEventListener("click", () => {
      fileUploadInput.click();
    });
  }

  if (fileUploadInput) {
    fileUploadInput.addEventListener("change", handleFileUpload);
  }

  // Add folder link event listeners
  const audioFolderLink = document.getElementById("audioFolderLink");
  const transcriptionsFolderLink = document.getElementById(
    "transcriptionsFolderLink"
  );

  if (audioFolderLink) {
    audioFolderLink.addEventListener("click", (e) => {
      e.preventDefault();
      openFolder(audioPath);
    });
  }

  if (transcriptionsFolderLink) {
    transcriptionsFolderLink.addEventListener("click", (e) => {
      e.preventDefault();
      openFolder(transcriptionsPath);
    });
  }

  // Add these DOM elements to the top section
  const toggleTranscriptionsButton = document.getElementById(
    "toggleTranscriptionsButton"
  );
  const transcriptionSection = document.getElementById("transcriptionSection");
  const fileList = document.getElementById("fileList");
  const playerContainer = document.getElementById("playerContainer");
  const transcriptionContainer = document.getElementById(
    "transcriptionContainer"
  );
  const audioPlayer = document.getElementById("audioPlayer");
  const transcriptionText = document.getElementById("transcriptionText");
  const currentFileName = document.getElementById("currentFileName");
  const playButton = document.getElementById("playButton");
  const progressBar = document.getElementById("progressBar");
  const progressBarFill = document.getElementById("progressBarFill");
  const timeDisplay = document.getElementById("timeDisplay");
  const waveformCanvas = document.getElementById("waveform");
  const refreshButton = document.getElementById("refreshButton");
  let waveformContext;

  // Add these event listeners in the DOMContentLoaded section
  if (toggleTranscriptionsButton) {
    // Change the button text to "Sync"
    toggleTranscriptionsButton.textContent = "🔄 Sync Transcriptions";

    // Always display the transcription section
    transcriptionSection.style.display = "block";

    // Load transcriptions immediately on page load
    loadTranscriptions();

    // Change the button function to just refresh transcriptions
    toggleTranscriptionsButton.addEventListener("click", () => {
      // Show loading indicator on the button itself
      toggleTranscriptionsButton.textContent = "🔄 Syncing...";
      toggleTranscriptionsButton.disabled = true;

      // Reload transcriptions
      loadTranscriptions().finally(() => {
        // Reset button state when done
        toggleTranscriptionsButton.textContent = "🔄 Sync Transcriptions";
        toggleTranscriptionsButton.disabled = false;
      });
    });
  }

  // Audio player event listeners
  if (playButton) {
    playButton.addEventListener("click", togglePlay);
  }

  if (progressBar) {
    progressBar.addEventListener("click", seekAudio);
  }

  if (audioPlayer) {
    audioPlayer.addEventListener("timeupdate", updateProgress);
    audioPlayer.addEventListener("ended", () => {
      playButton.textContent = "▶";
    });
    audioPlayer.addEventListener("play", () => {
      playButton.textContent = "❚❚";
    });
    audioPlayer.addEventListener("pause", () => {
      playButton.textContent = "▶";
    });
  }

  // Initialize waveform canvas
  if (waveformCanvas) {
    waveformContext = waveformCanvas.getContext("2d");
    waveformCanvas.width = waveformCanvas.offsetWidth;
    waveformCanvas.height = waveformCanvas.offsetHeight;
  }

  // Make sure we're using the correct button ID for the sync button
  const syncTranscriptionsButton = document.getElementById(
    "syncTranscriptionsButton"
  );

  if (syncTranscriptionsButton) {
    // Change the button text to "Sync"
    syncTranscriptionsButton.textContent = "🔄 Sync Transcriptions";

    // Always display the transcription section
    transcriptionSection.style.display = "block";

    // Load transcriptions immediately on page load
    loadTranscriptions();

    // Change the button function to just refresh transcriptions
    syncTranscriptionsButton.addEventListener("click", () => {
      // Show loading indicator on the button itself
      syncTranscriptionsButton.textContent = "🔄 Syncing...";
      syncTranscriptionsButton.disabled = true;

      // Reload transcriptions
      loadTranscriptions().finally(() => {
        // Reset button state when done
        syncTranscriptionsButton.textContent = "🔄 Sync Transcriptions";
        syncTranscriptionsButton.disabled = false;
      });
    });
  }

  // Add this inside the DOMContentLoaded event
  const fetchAllButton = document.getElementById("fetchAllButton");
  if (fetchAllButton) {
    fetchAllButton.addEventListener("click", async () => {
      try {
        fetchAllButton.disabled = true;
        fetchAllButton.textContent = "Fetching...";

        await fetchAllTranscriptions();

        fetchAllButton.textContent = "Fetch All Transcriptions";

        // Show a success notification
        if (status) {
          status.textContent = `Successfully fetched all transcriptions`;
          setTimeout(() => {
            status.textContent = "";
          }, 5000);
        }
      } catch (error) {
        console.error("Error in fetchAll:", error);
        if (status) {
          status.textContent = `Error fetching transcriptions: ${error.message}`;
        }
      } finally {
        fetchAllButton.disabled = false;
      }
    });
  }
});

// Create necessary directories
function ensureDirectoriesExist() {
  const downloadsPath = path.join(homedir(), "Downloads", "transcriber");
  const audioPath = path.join(downloadsPath, "audios");
  const transcriptionsPath = path.join(downloadsPath, "transcriptions");
  const pendingPath = path.join(downloadsPath, "pending");

  if (!fs.existsSync(downloadsPath)) {
    fs.mkdirSync(downloadsPath, { recursive: true });
  }
  if (!fs.existsSync(audioPath)) {
    fs.mkdirSync(audioPath, { recursive: true });
  }
  if (!fs.existsSync(transcriptionsPath)) {
    fs.mkdirSync(transcriptionsPath, { recursive: true });
  }
  if (!fs.existsSync(pendingPath)) {
    fs.mkdirSync(pendingPath, { recursive: true });
  }

  return { audioPath, transcriptionsPath, pendingPath };
}

// Create directories on startup
const { audioPath, transcriptionsPath, pendingPath } = ensureDirectoriesExist();

// Load and resume any pending transcriptions
function resumePendingTranscriptions() {
  try {
    const pendingFiles = fs.readdirSync(pendingPath);

    if (pendingFiles.length > 0) {
      console.log(
        `Found ${pendingFiles.length} pending transcription(s), resuming...`
      );

      pendingFiles.forEach((file) => {
        if (file.endsWith(".json")) {
          try {
            const filePath = path.join(pendingPath, file);
            const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

            if (data.transcriptionId) {
              console.log(`Resuming transcription ${data.transcriptionId}...`);
              pollTranscriptionStatus(data.transcriptionId, data.startTime);
            }
          } catch (err) {
            console.error("Error parsing pending file:", err);
          }
        }
      });
    }
  } catch (error) {
    console.error("Error loading pending transcriptions:", error);
  }
}

// Call on startup
resumePendingTranscriptions();

async function startRecording() {
  try {
    status.textContent = "Requesting permissions...";

    // Request microphone audio only for stability
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });

    // Set up audio visualization
    setupAudioVisualization(stream);

    // Create media recorder with microphone stream
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
    });

    recordedChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    mediaRecorder.onerror = (error) => {
      console.error("MediaRecorder error:", error);
      status.textContent = `Recording error: ${error.message}`;
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, {
        type: "audio/webm; codecs=opus",
      });
      console.log("Recording finished, blob size:", blob.size);
      status.textContent = "Recording saved, sending for transcription...";

      // Save the recording and send for transcription
      saveRecordingAndTranscribe(blob);
    };

    mediaRecorder.start(1000);
    recordButton.textContent = "Stop Recording";
    recordButton.classList.add("recording");
    status.textContent = "Recording...";
  } catch (error) {
    console.error("Error starting recording:", error);
    status.textContent = `Error: ${error.message}`;
    throw error;
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    recordButton.textContent = "Start Recording";
    recordButton.classList.remove("recording");
    status.textContent = "Processing...";

    // Stop visualization
    stopVisualization();
  }
}

// Function to save the recording and send for transcription
async function saveRecordingAndTranscribe(blob) {
  try {
    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `recording-${timestamp}.webm`;
    const filePath = path.join(audioPath, filename);

    // Convert blob to buffer and save it
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(filePath, buffer);

    // Send the file to the backend for transcription
    status.textContent = "Sending to backend for transcription...";
    sendToBackendForTranscription(filePath, filename);
  } catch (error) {
    console.error("Error saving recording:", error);
    status.textContent = `Error saving recording: ${error.message}`;
  }
}

// Send the file to the backend for transcription
function sendToBackendForTranscription(filePath, filename) {
  // Create a FormData object
  const formData = new FormData();
  const file = fs.readFileSync(filePath);
  const blob = new Blob([file], { type: "audio/webm;codecs=opus" });

  formData.append("audio", blob, filename);

  // Send the file to the backend
  fetch("http://localhost:3000/upload", {
    method: "POST",
    body: formData,
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      console.log("Upload successful:", data);
      status.textContent = "Audio uploaded, transcription in progress...";

      // Start polling for transcription status
      if (data.transcriptionId) {
        // Save the pending transcription info to file
        savePendingTranscription(data.transcriptionId, filePath);

        // Start polling
        pollTranscriptionStatus(data.transcriptionId, new Date().getTime());
      }
    })
    .catch((error) => {
      console.error("Error uploading file:", error);
      status.textContent = `Error uploading file: ${error.message}`;
    });
}

// Save pending transcription to persistence
function savePendingTranscription(transcriptionId, audioFilePath) {
  try {
    const pendingFile = path.join(pendingPath, `${transcriptionId}.json`);
    const pendingData = {
      transcriptionId,
      audioFilePath,
      startTime: new Date().getTime(),
      timestamp: new Date().toISOString(),
    };

    fs.writeFileSync(pendingFile, JSON.stringify(pendingData, null, 2));
    console.log(`Saved pending transcription ${transcriptionId} to file`);
  } catch (error) {
    console.error("Error saving pending transcription:", error);
  }
}

// Remove pending transcription file
function removePendingTranscription(transcriptionId) {
  try {
    const pendingFile = path.join(pendingPath, `${transcriptionId}.json`);
    if (fs.existsSync(pendingFile)) {
      fs.unlinkSync(pendingFile);
      console.log(`Removed pending transcription ${transcriptionId}`);
    }
  } catch (error) {
    console.error("Error removing pending transcription:", error);
  }
}

// Poll the backend for transcription status
function pollTranscriptionStatus(transcriptionId, startTime) {
  // Clear any existing interval for this ID
  if (pollingIntervals[transcriptionId]) {
    clearInterval(pollingIntervals[transcriptionId]);
  }

  const MAX_POLLING_TIME = 4 * 60 * 60 * 1000; // 4 hours in milliseconds
  const POLLING_INTERVAL = 15000; // Check every 15 seconds

  const currentTime = new Date().getTime();
  const elapsedTime = currentTime - startTime;

  // If we've been polling too long, switch to a manual check approach
  if (elapsedTime > MAX_POLLING_TIME) {
    status.textContent = `Transcription ${transcriptionId} is taking longer than expected. Click "Check Status" to check manually.`;
    addCheckStatusButton(transcriptionId);
    return;
  }

  // Set up polling with progressively longer intervals
  const adjustedInterval =
    POLLING_INTERVAL + Math.floor(elapsedTime / (30 * 60 * 1000)) * 15000; // Add 15s for every 30min elapsed

  pollingIntervals[transcriptionId] = setInterval(() => {
    const nowTime = new Date().getTime();
    const totalElapsed = nowTime - startTime;

    // Check if we need to stop automatic polling
    if (totalElapsed > MAX_POLLING_TIME) {
      clearInterval(pollingIntervals[transcriptionId]);
      status.textContent = `Transcription ${transcriptionId} is taking longer than expected. Click "Check Status" to check manually.`;
      addCheckStatusButton(transcriptionId);
      return;
    }

    // Otherwise continue polling
    checkTranscriptionStatus(transcriptionId);
  }, adjustedInterval);

  // Immediately perform a first check
  checkTranscriptionStatus(transcriptionId);
}

// Add a button to manually check status
function addCheckStatusButton(transcriptionId) {
  // Check if button already exists
  if (document.getElementById("checkStatusButton")) {
    return;
  }

  const button = document.createElement("button");
  button.id = "checkStatusButton";
  button.textContent = "Check Transcription Status";
  button.onclick = () => checkTranscriptionStatus(transcriptionId);

  // Add after record button
  recordButton.parentNode.insertBefore(button, recordButton.nextSibling);
}

// Check transcription status
function checkTranscriptionStatus(transcriptionId) {
  status.textContent = `Verificando status da transcrição ${transcriptionId}...`;

  fetch(`http://localhost:3000/transcription/${transcriptionId}`)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      console.log("Transcription status:", data);

      if (data.status === "completed") {
        if (pollingIntervals[transcriptionId]) {
          clearInterval(pollingIntervals[transcriptionId]);
          delete pollingIntervals[transcriptionId];
        }

        status.textContent = "Transcrição concluída!";

        // Remove the pending transcription file
        removePendingTranscription(transcriptionId);

        // Remove the check status button if it exists
        const checkButton = document.getElementById("checkStatusButton");
        if (checkButton) {
          checkButton.parentNode.removeChild(checkButton);
        }

        // Get full transcription details
        console.log("Fetching complete transcription details...");
        return fetch(
          `http://localhost:3000/transcription/${transcriptionId}/details`
        );
      } else if (data.status === "error") {
        if (pollingIntervals[transcriptionId]) {
          clearInterval(pollingIntervals[transcriptionId]);
          delete pollingIntervals[transcriptionId];
        }

        // Remove the pending transcription file
        removePendingTranscription(transcriptionId);

        status.textContent = `Transcription error: ${
          data.error || "Unknown error"
        }`;
        throw new Error(data.error || "Unknown error");
      } else {
        status.textContent = `Transcrição em andamento: ${data.status}`;
        return null;
      }
    })
    .then((response) => {
      if (!response) return null;

      if (!response.ok) {
        console.error(`Error fetching details: ${response.status}`);
        status.textContent = `Error fetching transcription details: ${response.status}`;
        throw new Error(`Error fetching details: ${response.status}`);
      }
      return response.json();
    })
    .then((details) => {
      if (details) {
        console.log("Received transcription details:", details);
        // Save transcription to file
        saveTranscriptionToFile(details);
      }
    })
    .catch((error) => {
      console.error("Error checking transcription status:", error);
      status.textContent = `Error checking transcription: ${error.message}`;

      // Add a retry button
      if (!document.getElementById("retryButton")) {
        const retryButton = document.createElement("button");
        retryButton.id = "retryButton";
        retryButton.textContent = "Retry";
        retryButton.onclick = () => checkTranscriptionStatus(transcriptionId);
        status.parentNode.insertBefore(retryButton, status.nextSibling);
      }
    });
}

// Save transcription to file
function saveTranscriptionToFile(transcription) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `transcription-${timestamp}.json`;
    const filePath = path.join(transcriptionsPath, filename);

    fs.writeFileSync(filePath, JSON.stringify(transcription, null, 2));
    console.log("Transcription saved to:", filePath);
    status.textContent = `Transcription saved to: ${filePath}`;
  } catch (error) {
    console.error("Error saving transcription:", error);
    status.textContent = `Error saving transcription: ${error.message}`;
  }
}

// Solicita as fontes de áudio ao iniciar
ipcRenderer.send("get-sources");

// Tratamento de erros das fontes
ipcRenderer.on("sources-error", (_, error) => {
  console.error("Error getting sources:", error);
  status.textContent = `Error getting sources: ${error}`;
});

// Add these new functions for audio visualization
function setupAudioVisualization(stream) {
  // Hide the "waiting for input" text
  if (visualizerText) visualizerText.style.display = "none";

  // Create audio context if it doesn't exist
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  // Create an analyser node
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;

  // Connect the microphone stream to the analyser
  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);

  // Create a buffer for the waveform data
  const bufferLength = analyser.frequencyBinCount;
  dataArray = new Uint8Array(bufferLength);

  // Start drawing the visualization
  drawVisualization();
}

function drawVisualization() {
  // Request the next animation frame
  animationId = requestAnimationFrame(drawVisualization);

  // Get canvas dimensions
  const width = visualizerCanvas.width;
  const height = visualizerCanvas.height;

  // Clear the canvas
  canvasContext.fillStyle = "#000";
  canvasContext.fillRect(0, 0, width, height);

  // Get the current audio data
  analyser.getByteTimeDomainData(dataArray);

  // Draw the waveform
  canvasContext.lineWidth = 2;
  canvasContext.strokeStyle = "#4285f4";
  canvasContext.beginPath();

  const sliceWidth = width / dataArray.length;
  let x = 0;

  for (let i = 0; i < dataArray.length; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * height) / 2;

    if (i === 0) {
      canvasContext.moveTo(x, y);
    } else {
      canvasContext.lineTo(x, y);
    }

    x += sliceWidth;
  }

  canvasContext.lineTo(width, height / 2);
  canvasContext.stroke();

  // Add a gradient line for visual appeal
  const gradient = canvasContext.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "rgba(66, 133, 244, 0.2)");
  gradient.addColorStop(1, "rgba(66, 133, 244, 0)");

  canvasContext.fillStyle = gradient;
  canvasContext.beginPath();
  x = 0;
  canvasContext.moveTo(0, height / 2);

  for (let i = 0; i < dataArray.length; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * height) / 2;
    canvasContext.lineTo(x, y);
    x += sliceWidth;
  }

  canvasContext.lineTo(width, height / 2);
  canvasContext.lineTo(width, height);
  canvasContext.lineTo(0, height);
  canvasContext.fill();
}

function stopVisualization() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  // Clear the canvas
  if (canvasContext && visualizerCanvas) {
    canvasContext.fillStyle = "#000";
    canvasContext.fillRect(
      0,
      0,
      visualizerCanvas.width,
      visualizerCanvas.height
    );
  }

  // Show the "waiting for input" text
  if (visualizerText) visualizerText.style.display = "block";
}

// Add a window resize event listener to adjust canvas size
window.addEventListener("resize", () => {
  if (visualizerCanvas) {
    visualizerCanvas.width = visualizerCanvas.offsetWidth;
    visualizerCanvas.height = visualizerCanvas.offsetHeight;
  }
});

// Remove the debug button functionality
function debugCheckServerFiles() {
  console.log("Checking server files status...");
  fetch("http://localhost:3000/transcription-system/status")
    .then((response) => response.json())
    .then((data) => {
      console.log("Server file system status:", data);
      status.textContent = `Server has ${data.transcriptionFiles.length} transcription files and ${data.uploadFiles.length} uploads`;
    })
    .catch((error) => {
      console.error("Error checking server files:", error);
      status.textContent = `Error checking server: ${error.message}`;
    });
}

// Update file upload handler
function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Create FormData object
  const formData = new FormData();
  formData.append("audio", file);

  // Show upload progress
  uploadStatus.innerHTML = `Uploading: ${file.name}`;

  // Create progress bar
  const progressContainer = document.createElement("div");
  progressContainer.className = "progress-container";
  progressContainer.style.display = "block";

  const progressBar = document.createElement("div");
  progressBar.className = "progress-bar";
  progressContainer.appendChild(progressBar);

  uploadStatus.appendChild(progressContainer);

  // Create upload request
  const xhr = new XMLHttpRequest();

  // Setup progress event
  xhr.upload.addEventListener("progress", (event) => {
    if (event.lengthComputable) {
      const percentComplete = (event.loaded / event.total) * 100;
      progressBar.style.width = percentComplete + "%";
    }
  });

  // Handle response
  xhr.onload = function () {
    if (xhr.status === 200) {
      try {
        const response = JSON.parse(xhr.responseText);
        uploadStatus.innerHTML = `Upload complete! Transcription in progress.`;

        // Save pending transcription info
        const pendingInfo = {
          transcriptionId: response.transcriptionId,
          fileName: file.name,
          uploadTime: new Date().toISOString(),
        };

        // Show the transcription section
        if (transcriptionSection.style.display !== "block") {
          transcriptionSection.style.display = "block";
          toggleTranscriptionsButton.textContent = "Hide Transcriptions";
        }

        // Reload the file list
        setTimeout(loadAudioFiles, 1000);

        // Start polling for status
        pollTranscriptionStatus(response.transcriptionId);
      } catch (e) {
        uploadStatus.innerHTML = `Error processing response: ${e.message}`;
      }
    } else {
      uploadStatus.innerHTML = `Upload failed: ${xhr.status} ${xhr.statusText}`;
    }
  };

  xhr.onerror = function () {
    uploadStatus.innerHTML = "Upload failed: Network error";
  };

  // Send the request
  xhr.open("POST", "http://localhost:3000/upload", true);
  xhr.send(formData);
}

// Add function to open folder paths
function openFolder(folderPath) {
  shell
    .openPath(folderPath)
    .then((response) => {
      if (response) {
        console.error("Error opening folder:", response);
      }
    })
    .catch((err) => {
      console.error("Failed to open folder:", err);
    });
}

// Add loadAudioFiles and related functions from transcriptions.js
function loadAudioFiles() {
  try {
    console.log("Loading audio files from:", audioPath);
    console.log("Looking for transcriptions in:", transcriptionsPath);

    // Ensure our directories exist
    [audioPath, transcriptionsPath, pendingPath].forEach((dir) => {
      if (!fs.existsSync(dir)) {
        console.log(`Creating directory: ${dir}`);
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    // Get local files first
    const audioFiles = fs.existsSync(audioPath)
      ? fs.readdirSync(audioPath).filter((file) => file.endsWith(".webm"))
      : [];

    console.log("Found audio files:", audioFiles);

    // Get transcriptions from local filesystem
    const transcriptionFiles = fs.existsSync(transcriptionsPath)
      ? fs
          .readdirSync(transcriptionsPath)
          .filter((file) => file.endsWith(".json"))
      : [];

    console.log("Found transcription files:", transcriptionFiles);

    // Get pending files
    const pendingFiles = fs.existsSync(pendingPath)
      ? fs.readdirSync(pendingPath).filter((file) => file.endsWith(".json"))
      : [];

    // Create a map of pending transcriptions
    const pendingMap = new Map();
    pendingFiles.forEach((file) => {
      try {
        const data = JSON.parse(
          fs.readFileSync(path.join(pendingPath, file), "utf8")
        );
        if (data.audioFilePath) {
          const audioFilename = path.basename(data.audioFilePath);
          pendingMap.set(audioFilename, {
            id: data.transcriptionId,
            status: "pending",
          });
        }
      } catch (error) {
        console.error("Error parsing pending file:", error);
      }
    });

    // Display the file list
    displayAudioFiles(audioFiles, pendingMap, transcriptionFiles);
  } catch (error) {
    console.error("Error loading audio files:", error);
    if (fileList)
      fileList.innerHTML = `<div class="no-items">Error loading files: ${error.message}</div>`;
  }
}

// Enhanced function to find the matching transcription for an audio file
function findMatchingTranscriptionForAudio(audioFile, transcriptionFiles) {
  console.log(`Finding transcription for audio: ${audioFile}`);

  // Try multiple methods to find a match
  let matchedId = null;
  let matchMethod = null;

  // 1. Try to extract ID from filename if it follows naming convention
  const audioTimestamp = parseInt(audioFile.replace(/\.webm$/, ""));
  const audioDate = new Date(audioTimestamp);

  // Log all transcription files for debugging
  console.log("All available transcription files:", transcriptionFiles);

  // 2. Check transcription files one by one
  for (const transFile of transcriptionFiles) {
    try {
      const transPath = path.join(transcriptionsPath, transFile);
      const idMatch = transFile.match(/transcription-(.+)\.json/);
      if (!idMatch || !idMatch[1]) continue;

      const transcriptionId = idMatch[1];
      console.log(
        `Checking transcription file: ${transFile} with ID: ${transcriptionId}`
      );

      const content = fs.readFileSync(transPath, "utf8");
      const data = JSON.parse(content);

      // Examine transcription content
      if (data.text) {
        console.log(`Content preview: "${data.text.substring(0, 30)}..."`);
      }

      // Method 1: Check file paths stored in the transcription
      if (data.audioFile && typeof data.audioFile === "string") {
        if (data.audioFile.includes(audioFile)) {
          console.log(
            `✓ Direct match: audioFile property contains ${audioFile}`
          );
          matchedId = transcriptionId;
          matchMethod = "direct-reference";
          break;
        }
      }

      // Method 2: If the audioFilename property exists
      if (data.audioFilename && data.audioFilename === audioFile) {
        console.log(`✓ Filename match: audioFilename is exactly ${audioFile}`);
        matchedId = transcriptionId;
        matchMethod = "filename-match";
        break;
      }

      // Method 3: Compare created timestamps
      if (data.created_at) {
        const transDate = new Date(data.created_at);
        if (!isNaN(audioDate.getTime()) && !isNaN(transDate.getTime())) {
          const diffMs = Math.abs(transDate.getTime() - audioDate.getTime());
          if (diffMs < 60000) {
            // 1 minute
            console.log(`✓ Timestamp match: Created within ${diffMs}ms`);
            matchedId = transcriptionId;
            matchMethod = "timestamp-match";
            break;
          }
        }
      }

      // Method 4: Check file creation dates
      try {
        const audioStats = fs.statSync(path.join(audioPath, audioFile));
        const transStats = fs.statSync(transPath);

        const diffMs = Math.abs(
          audioStats.birthtimeMs - transStats.birthtimeMs
        );
        if (diffMs < 5 * 60 * 1000) {
          // 5 minutes
          console.log(`✓ File creation match: Created within ${diffMs}ms`);
          matchedId = transcriptionId;
          matchMethod = "file-timestamp";
          break;
        }
      } catch (e) {
        console.error("Error checking file stats:", e);
      }
    } catch (err) {
      console.error(`Error checking transcription ${transFile}:`, err);
    }
  }

  if (matchedId) {
    console.log(
      `✅ Matched audio ${audioFile} to transcription ${matchedId} using ${matchMethod}`
    );
  } else {
    console.log(`❌ No matching transcription found for ${audioFile}`);
  }

  return matchedId;
}

// Update the displayAudioFiles function to use our new matcher
function displayAudioFiles(audioFiles, pendingMap, transcriptionFiles) {
  if (!fileList) return;

  // Clear the file list
  fileList.innerHTML = "";

  if (audioFiles.length === 0) {
    fileList.innerHTML = '<div class="no-items">No audio files found</div>';
    return;
  }

  console.log(
    `Found ${audioFiles.length} audio files and ${transcriptionFiles.length} transcription files`
  );

  // Create a map of transcription IDs to filenames for quick lookup
  const transcriptionMap = new Map();
  transcriptionFiles.forEach((file) => {
    const idMatch = file.match(/transcription-(.+)\.json/);
    if (idMatch && idMatch[1]) {
      transcriptionMap.set(idMatch[1], file);
    }
  });

  // Display audio files sorted by date (newest first)
  audioFiles
    .sort((a, b) => {
      const timeA = parseInt(a.replace(/\.webm$/, "")) || 0;
      const timeB = parseInt(b.replace(/\.webm$/, "")) || 0;
      return timeB - timeA;
    })
    .forEach((file) => {
      const fileItem = document.createElement("div");
      fileItem.className = "file-item";

      // Determine file date
      let formattedDate = "Unknown Date";
      try {
        const timestamp = file.replace(/\.webm$/, "");
        const parsedTimestamp = parseInt(timestamp);

        if (!isNaN(parsedTimestamp)) {
          const date = new Date(parsedTimestamp);
          if (!isNaN(date.getTime())) {
            formattedDate = date.toLocaleString();
          }
        } else {
          // Fallback to file creation time
          const stats = fs.statSync(path.join(audioPath, file));
          formattedDate = new Date(stats.birthtime).toLocaleString();
        }
      } catch (error) {
        console.error(`Error parsing date for ${file}:`, error);
      }

      // Find matching transcription using our enhanced function
      const transcriptionId = findMatchingTranscriptionForAudio(
        file,
        transcriptionFiles
      );

      // Determine status based on whether we found a transcription
      let status = "none";
      if (transcriptionId) {
        status = "completed";
      } else if (pendingMap.has(file)) {
        status = "pending";
        transcriptionId = pendingMap.get(file).id;
      }

      // Add status indicator
      let statusHtml = "";
      if (status === "completed") {
        statusHtml =
          '<span class="status completed" title="Transcription completed">✓</span>';
      } else if (status === "pending") {
        statusHtml =
          '<span class="status pending" title="Transcription in progress">⌛</span>';
      }

      const fileName = `Recording ${formattedDate}`;

      fileItem.innerHTML = `
        <div class="file-name">${fileName} ${statusHtml}</div>
        <div class="file-actions">
          <button class="play-file">Play</button>
        </div>
      `;

      // Store data in dataset
      fileItem.dataset.audioFile = file;
      if (transcriptionId) {
        fileItem.dataset.transcriptionId = transcriptionId;
        fileItem.dataset.status = status;
      }

      // Add event listener to play button
      const playButton = fileItem.querySelector(".play-file");
      playButton.addEventListener("click", () => {
        playAudioWithTranscription(file, fileName, transcriptionId);
      });

      fileList.appendChild(fileItem);
    });
}

function playAudioWithTranscription(audioFile, displayName, transcriptionId) {
  console.log(`Playing ${audioFile} with transcription ID: ${transcriptionId}`);

  // Show audio player
  playerContainer.style.display = "block";
  currentFileName.textContent = displayName;

  // Set source and prepare player
  const fullAudioPath = path.join(audioPath, audioFile);
  console.log("Loading audio from:", fullAudioPath);
  audioPlayer.src = `file://${fullAudioPath}`;
  audioPlayer.style.display = "block"; // Make sure audio player is visible
  audioPlayer.load(); // Force reload

  // Reset UI
  playButton.textContent = "▶";
  progressBarFill.style.width = "0%";
  timeDisplay.textContent = "00:00 / 00:00";

  // Clear previous transcription before loading a new one
  transcriptionContainer.style.display = "block";
  transcriptionText.textContent = "Loading transcription...";

  // Load and display transcription if available
  if (transcriptionId) {
    const transcriptionFile = `transcription-${transcriptionId}.json`;
    const transcriptionPath = path.join(transcriptionsPath, transcriptionFile);
    console.log(`Looking for transcription at: ${transcriptionPath}`);

    if (fs.existsSync(transcriptionPath)) {
      try {
        console.log(`Found transcription file: ${transcriptionFile}`);
        const content = fs.readFileSync(transcriptionPath, "utf8");
        const data = JSON.parse(content);

        // Use formatted_text if available, otherwise use plain text
        const displayText =
          data.formatted_text || data.text || "No text in transcription";

        // Log what we're about to display
        console.log(
          `Using ${
            data.formatted_text ? "formatted_text" : "text"
          } field from transcription`
        );
        console.log(
          `Transcription to display: "${displayText.substring(0, 100)}..."`
        );

        // Update the UI
        transcriptionText.textContent = displayText;
      } catch (err) {
        console.error("Error loading transcription file:", err);
        transcriptionText.textContent = `Error loading transcription: ${err.message}`;
      }
    } else {
      console.log(`Transcription file not found locally, trying server...`);
      transcriptionText.textContent = "Fetching transcription from server...";

      // Clear any previous fetch attempts
      const controller = new AbortController();
      const signal = controller.signal;

      fetch(`http://localhost:3000/transcription/${transcriptionId}/details`, {
        signal,
      })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP error ${response.status}`);
          return response.json();
        })
        .then((data) => {
          // Use formatted_text if available, otherwise use plain text
          const displayText =
            data.formatted_text || data.text || "No text in transcription";

          // Log server response
          console.log(
            `Server returned transcription for ID ${transcriptionId}`
          );
          console.log(
            `Using ${
              data.formatted_text ? "formatted_text" : "text"
            } field from transcription`
          );

          // Update UI
          transcriptionText.textContent = displayText;

          // Save locally for next time
          if (!fs.existsSync(transcriptionsPath)) {
            fs.mkdirSync(transcriptionsPath, { recursive: true });
          }
          fs.writeFileSync(transcriptionPath, JSON.stringify(data, null, 2));
          console.log(`Saved transcription to ${transcriptionPath}`);
        })
        .catch((err) => {
          if (err.name === "AbortError") {
            console.log("Fetch was aborted");
          } else {
            console.error("Error fetching transcription:", err);
            transcriptionText.textContent = `Error fetching transcription: ${err.message}`;
          }
        });

      return () => {
        controller.abort(); // Abort fetch if component is unmounted
      };
    }
  } else {
    console.log(`No transcription ID provided for ${audioFile}`);
    transcriptionText.textContent = "No transcription available for this audio";
  }
}

function togglePlay() {
  if (audioPlayer.paused) {
    audioPlayer.play();
  } else {
    audioPlayer.pause();
  }
}

function updateProgress() {
  const currentTime = audioPlayer.currentTime;
  const duration = audioPlayer.duration;

  // Update progress bar
  if (duration > 0) {
    const percent = (currentTime / duration) * 100;
    progressBarFill.style.width = `${percent}%`;
  }

  // Update time display
  timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(
    duration
  )}`;
}

function seekAudio(e) {
  const percent = e.offsetX / progressBar.offsetWidth;
  audioPlayer.currentTime = percent * audioPlayer.duration;
  updateProgress();
}

function formatTime(seconds) {
  seconds = Math.floor(seconds || 0);
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

// Add this function to fetch all transcriptions
async function fetchAllTranscriptions() {
  console.log("Fetching all transcriptions from server...");

  try {
    const response = await fetch("http://localhost:3000/transcriptions/all");

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    const data = await response.json();
    console.log(
      `Received ${data.transcriptions.length} transcriptions and ${
        data.pending?.length || 0
      } pending transcriptions`
    );

    // Save all received transcriptions locally for offline access
    if (!fs.existsSync(transcriptionsPath)) {
      fs.mkdirSync(transcriptionsPath, { recursive: true });
    }

    // Process and save each transcription
    data.transcriptions.forEach((transcription) => {
      if (transcription.id) {
        const transcriptionFile = `transcription-${transcription.id}.json`;
        const transcriptionFilePath = path.join(
          transcriptionsPath,
          transcriptionFile
        );

        // Only write if the file doesn't exist or has different content
        if (!fs.existsSync(transcriptionFilePath)) {
          fs.writeFileSync(
            transcriptionFilePath,
            JSON.stringify(transcription, null, 2)
          );
          console.log(`Saved new transcription to ${transcriptionFilePath}`);
        }
      }
    });

    // Refresh the UI to show new transcriptions
    if (fileList) {
      // Reload the displayed files using our new method
      loadTranscriptions();
    }

    return data;
  } catch (error) {
    console.error("Error fetching all transcriptions:", error);
    throw error;
  }
}

// Update the loadTranscriptions function to return a promise
async function loadTranscriptions() {
  try {
    const fileList = document.getElementById("fileList");
    fileList.innerHTML = '<div class="loading">Loading transcriptions...</div>';

    // More detailed logging
    console.log(
      "Fetching transcriptions from http://localhost:3000/transcriptions/all",
      new Date().toISOString()
    );
    const response = await fetch("http://localhost:3000/transcriptions/all");
    if (!response.ok) {
      let errorText = "";
      try {
        errorText = await response.text();
      } catch (e) {
        errorText = "Could not get error details";
      }
      console.error(`Fetch error: ${response.status}`, errorText);
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();
    console.log("Received transcriptions:", data);

    // Clear loading message
    fileList.innerHTML = "";

    if (data.transcriptions.length === 0) {
      fileList.innerHTML =
        '<div class="no-items">No transcriptions found.</div>';
      return;
    }

    // Sort transcriptions by date (newest first)
    const sortedTranscriptions = data.transcriptions.sort((a, b) => {
      return new Date(b.created_at) - new Date(a.created_at);
    });

    // Display each transcription
    sortedTranscriptions.forEach((item) => {
      displayTranscriptionItem(item);
    });
  } catch (error) {
    console.error("Error loading transcriptions:", error);
    document.getElementById(
      "fileList"
    ).innerHTML = `<div class="error">Error loading transcriptions: ${error.message}</div>`;
    throw error; // Rethrow the error to be caught by the caller
  }
}

// Update the displayTranscriptionItem function to use formatted_text from database
function displayTranscriptionItem(item) {
  const listItem = document.createElement("div");
  listItem.className = "file-item";

  // Format the date nicely
  let dateDisplay = "Unknown date";
  try {
    const date = new Date(item.created_at);
    if (!isNaN(date)) {
      dateDisplay = date.toLocaleString();
    }
  } catch (e) {
    console.error("Error formatting date:", e);
  }

  // Display original filename if available, otherwise use audio_filename
  const displayFilename =
    item.original_filename || item.audio_filename || "Unknown file";

  // Get a preview of the transcription text
  const textPreview = item.formatted_text
    ? item.formatted_text.substring(0, 100) +
      (item.formatted_text.length > 100 ? "..." : "")
    : item.text_preview
    ? item.text_preview
    : "Processing transcription...";

  // Determine if audio is available
  const hasAudio = item.audio_filename && item.audio_filename.length > 0;
  const hasTranscription = item.has_text;

  listItem.innerHTML = `
    <div class="transcription-header">
      <div class="transcription-info">
        <div class="transcription-info-row">
          <span class="transcription-date">${dateDisplay}</span>
          ${
            hasAudio
              ? `<span class="transcription-filename">${displayFilename}</span>`
              : ""
          }
        </div>
        <div class="transcription-preview">${textPreview}</div>
      </div>
      <div class="transcription-actions">
        <button class="toggle-button">▼</button>
        ${hasAudio ? '<button class="play-audio-button">Play</button>' : ""}
        ${
          hasTranscription
            ? '<button class="download-transcription-button">Download</button>'
            : ""
        }
      </div>
    </div>
    <div class="transcription-details" style="display: none;">
      <div class="transcription-content">
        <p>Loading transcription content...</p>
      </div>
      ${
        hasAudio
          ? `<div class="audio-container">
               <h4>Audio: ${displayFilename}</h4>
               <audio controls src="file://${path.join(
                 homedir(),
                 "Downloads",
                 "transcriber",
                 "audios",
                 item.audio_filename
               )}"></audio>
               <div class="audio-filename">Saved as: ${
                 item.audio_filename
               }</div>
             </div>`
          : '<div class="no-audio-message">No audio available locally</div>'
      }
    </div>
  `;

  // Add the item to the list
  const fileList = document.getElementById("fileList");
  fileList.appendChild(listItem);

  // Add event listeners
  const toggleButton = listItem.querySelector(".toggle-button");
  const transcriptionDetails = listItem.querySelector(".transcription-details");

  toggleButton.addEventListener("click", async () => {
    const isVisible = transcriptionDetails.style.display !== "none";

    if (isVisible) {
      transcriptionDetails.style.display = "none";
      toggleButton.textContent = "▼"; // Down arrow when collapsed
    } else {
      transcriptionDetails.style.display = "block";
      toggleButton.textContent = "▲"; // Up arrow when expanded

      // If we already have formatted_text in the item, use it directly
      if (item.formatted_text) {
        transcriptionDetails.querySelector(
          ".transcription-content"
        ).innerHTML = `<pre>${item.formatted_text}</pre>`;
      }
      // Otherwise, load from server
      else if (
        item.has_text &&
        !transcriptionDetails
          .querySelector(".transcription-content")
          .textContent.trim()
      ) {
        try {
          const response = await fetch(
            `http://localhost:3000/transcriptions/${item.id}`
          );
          if (response.ok) {
            const data = await response.json();
            if (data.formatted_text) {
              transcriptionDetails.querySelector(
                ".transcription-content"
              ).innerHTML = `<pre>${data.formatted_text}</pre>`;
            } else if (data.text) {
              transcriptionDetails.querySelector(
                ".transcription-content"
              ).innerHTML = `<pre>${data.text}</pre>`;
            }
          }
        } catch (error) {
          console.error("Error loading transcription content:", error);
          transcriptionDetails.querySelector(
            ".transcription-content"
          ).innerHTML = `<p class="error">Error loading transcription: ${error.message}</p>`;
        }
      }
    }
  });

  // Add download button functionality if transcription is available
  if (hasTranscription) {
    const downloadButton = listItem.querySelector(
      ".download-transcription-button"
    );
    downloadButton.addEventListener("click", () => {
      window.open(
        `http://localhost:3000/transcriptions/${item.id}/download`,
        "_blank"
      );
    });
  }

  // Add play button functionality if audio is available
  if (hasAudio) {
    const playButton = listItem.querySelector(".play-audio-button");
    playButton.addEventListener("click", () => {
      playAudioWithTranscription(item.audio_filename, displayFilename, item.id);
    });
  }
}

// You may also need to update the function that checks for transcription status
async function checkTranscriptionStatus(transcriptionId) {
  try {
    const response = await fetch(
      `http://localhost:3000/transcriptions/${transcriptionId}`
    );
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(
      `Error checking transcription status for ${transcriptionId}:`,
      error
    );
    throw error;
  }
}
