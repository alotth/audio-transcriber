const fs = require("fs");
const path = require("path");
const { homedir } = require("os");

// DOM elements
const fileList = document.getElementById("fileList");
const playerContainer = document.getElementById("playerContainer");
const transcriptionContainer = document.getElementById("transcriptionContainer");
const audioPlayer = document.getElementById("audioPlayer");
const transcriptionText = document.getElementById("transcriptionText");
const currentFileName = document.getElementById("currentFileName");
const backButton = document.getElementById("backButton");
const playButton = document.getElementById("playButton");
const progressBar = document.getElementById("progressBar");
const progressBarFill = document.getElementById("progressBarFill");
const timeDisplay = document.getElementById("timeDisplay");
const waveformCanvas = document.getElementById("waveform");
const refreshButton = document.getElementById("refreshButton");
let waveformContext;
let audioContext;
let analyser;
let dataArray;
let audioSource;

// Paths
const downloadsPath = path.join(homedir(), "Downloads", "transcriber");
const audioPath = path.join(downloadsPath, "audios");
const transcriptionsPath = path.join(downloadsPath, "transcriptions");
const pendingPath = path.join(downloadsPath, "pending");

// Initialize
loadAudioFiles();

// Initialize waveform canvas
if (waveformCanvas) {
  waveformContext = waveformCanvas.getContext("2d");
  waveformCanvas.width = waveformCanvas.offsetWidth;
  waveformCanvas.height = waveformCanvas.offsetHeight;
}

// Event listeners
backButton.addEventListener("click", () => {
  window.location.href = "index.html";
});

// Event listeners for audio player
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

// Add this after the existing event listeners
if (refreshButton) {
  refreshButton.addEventListener("click", () => {
    console.log("Refreshing transcription list...");
    
    // Show loading indicator
    const oldContent = refreshButton.innerHTML;
    refreshButton.innerHTML = "⟳ Loading...";
    refreshButton.disabled = true;
    
    // Load files
    loadAudioFiles();
    
    // Restore button after a short delay
    setTimeout(() => {
      refreshButton.innerHTML = oldContent;
      refreshButton.disabled = false;
    }, 1000);
  });
}

// Functions
function loadAudioFiles() {
  try {
    // Check for recently uploaded file from localStorage
    const lastUpload = localStorage.getItem('lastUpload');
    if (lastUpload) {
      try {
        const uploadInfo = JSON.parse(lastUpload);
        console.log("Found recent upload:", uploadInfo);
        
        // Start polling for this transcription
        if (uploadInfo.transcriptionId) {
          pollForTranscriptionStatus(uploadInfo.transcriptionId);
        }
        
        // Clear the localStorage item
        localStorage.removeItem('lastUpload');
      } catch (err) {
        console.error("Error parsing last upload:", err);
      }
    }
    
    console.log("Loading audio files from:", audioPath);
    console.log("Looking for transcriptions in:", transcriptionsPath);
    
    // Ensure our directories exist
    [audioPath, transcriptionsPath, pendingPath].forEach(dir => {
      if (!fs.existsSync(dir)) {
        console.log(`Creating directory: ${dir}`);
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    // Get local files first
    const audioFiles = fs.existsSync(audioPath)
      ? fs.readdirSync(audioPath).filter(file => file.endsWith(".webm"))
      : [];
    
    console.log("Found audio files:", audioFiles);
    
    // Get transcriptions from local filesystem
    const transcriptionFiles = fs.existsSync(transcriptionsPath)
      ? fs.readdirSync(transcriptionsPath).filter(file => file.endsWith(".json"))
      : [];
    
    console.log("Found transcription files:", transcriptionFiles);
    
    // Get pending files
    const pendingFiles = fs.existsSync(pendingPath)
      ? fs.readdirSync(pendingPath).filter(file => file.endsWith(".json"))
      : [];
    
    // Create a map of pending transcriptions
    const pendingMap = new Map();
    pendingFiles.forEach(file => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(pendingPath, file), "utf8"));
        if (data.audioFilePath) {
          const audioFilename = path.basename(data.audioFilePath);
          pendingMap.set(audioFilename, {
            id: data.transcriptionId,
            status: "pending"
          });
        }
      } catch (error) {
        console.error("Error parsing pending file:", error);
      }
    });
    
    // Render the file list
    displayAudioFiles(audioFiles, pendingMap, transcriptionFiles);
    
    // Then check server for any additional transcriptions
    fetch("http://localhost:3000/transcription-system/status")
      .then(response => response.json())
      .then(data => {
        console.log("Server status:", data);
        
        // Check for any new server transcriptions
        const serverTranscriptions = data.transcriptionFiles || [];
        let newTranscriptionsFound = false;
        
        // Download any transcriptions that don't exist locally
        const promises = serverTranscriptions.map(filename => {
          if (!transcriptionFiles.includes(filename)) {
            newTranscriptionsFound = true;
            return downloadTranscription(filename);
          }
          return Promise.resolve();
        });
        
        // If we found new transcriptions, refresh the display after downloading
        if (newTranscriptionsFound) {
          Promise.all(promises).then(() => {
            // Reload transcription files
            const updatedTranscriptionFiles = fs.existsSync(transcriptionsPath)
              ? fs.readdirSync(transcriptionsPath).filter(file => file.endsWith(".json"))
              : [];
            
            // Update display
            displayAudioFiles(audioFiles, pendingMap, updatedTranscriptionFiles);
          });
        }
      })
      .catch(error => {
        console.error("Error checking server status:", error);
      });
  } catch (error) {
    console.error("Error loading files:", error);
    fileList.innerHTML = `<div class="no-items">Error loading files: ${error.message}</div>`;
  }
}

// Function to download a transcription from the server
function downloadTranscription(filename) {
  // Extract ID from filename: transcription-ID.json
  const idMatch = filename.match(/transcription-(.+)\.json/);
  if (!idMatch || !idMatch[1]) return Promise.resolve();
  
  const transcriptionId = idMatch[1];
  const localPath = path.join(transcriptionsPath, filename);
  
  console.log(`Downloading transcription ${transcriptionId} from server...`);
  
  return fetch(`http://localhost:3000/transcription/${transcriptionId}/details`)
    .then(response => response.json())
    .then(details => {
      // Ensure directory exists
      if (!fs.existsSync(transcriptionsPath)) {
        fs.mkdirSync(transcriptionsPath, { recursive: true });
      }
      
      // Save file
      fs.writeFileSync(localPath, JSON.stringify(details, null, 2));
      console.log(`Saved transcription to ${localPath}`);
      return details;
    })
    .catch(error => {
      console.error(`Error downloading transcription ${transcriptionId}:`, error);
    });
}

// Fix the displayAudioFiles function to properly handle status
function displayAudioFiles(audioFiles, pendingMap, transcriptionFiles) {
  // Clear the file list
  fileList.innerHTML = "";
  
  if (audioFiles.length === 0) {
    fileList.innerHTML = '<div class="no-items">No audio files found</div>';
    return;
  }
  
  console.log("Displaying audio files:", audioFiles.length);
  console.log("Transcription files:", transcriptionFiles.length);
  console.log("Pending map size:", pendingMap.size);
  
  // Create a map of transcription IDs to filenames for quick lookup
  const transcriptionMap = new Map();
  transcriptionFiles.forEach(file => {
    const idMatch = file.match(/transcription-(.+)\.json/);
    if (idMatch && idMatch[1]) {
      transcriptionMap.set(idMatch[1], file);
    }
  });
  
  console.log("Transcription map:", Array.from(transcriptionMap.entries()));
  
  // Clean up the pending map - remove entries that now have completed transcriptions
  // This fixes the issue where files show as pending even when complete
  pendingMap.forEach((pendingInfo, audioFile) => {
    if (transcriptionMap.has(pendingInfo.id)) {
      console.log(`Removing ${audioFile} from pending - transcription exists`);
      pendingMap.delete(audioFile);
    }
  });
  
  // Display audio files sorted by date (newest first)
  audioFiles
    .sort((a, b) => {
      const timeA = parseInt(a.replace(/\.webm$/, "")) || 0;
      const timeB = parseInt(b.replace(/\.webm$/, "")) || 0;
      return timeB - timeA;
    })
    .forEach(file => {
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
      
      // First determine if there's a completed transcription
      let status = "none";
      let transcriptionId = null;
      
      // Check for matching transcriptions - PRIORITY 1
      for (const [id, transFile] of transcriptionMap.entries()) {
        try {
          const transPath = path.join(transcriptionsPath, transFile);
          const fileStats = fs.statSync(path.join(audioPath, file));
          const transStats = fs.statSync(transPath);
          
          // If audio file and transcription created within 5 minutes of each other
          if (Math.abs(fileStats.birthtimeMs - transStats.birthtimeMs) < 5 * 60 * 1000) {
            transcriptionId = id;
            status = "completed";
            console.log(`Matched ${file} to transcription ${id} by timestamp`);
            break;
          }
          
          // Also check content for filename
          const transContent = fs.readFileSync(transPath, 'utf8');
          if (transContent.includes(file)) {
            transcriptionId = id;
            status = "completed";
            console.log(`Matched ${file} to transcription ${id} by content reference`);
            break;
          }
        } catch (e) {
          console.error(`Error checking transcription match for ${file}:`, e);
        }
      }
      
      // If no transcription found, check if pending - PRIORITY 2
      if (status === "none" && pendingMap.has(file)) {
        status = "pending";
        transcriptionId = pendingMap.get(file).id;
        console.log(`File ${file} is pending with ID ${transcriptionId}`);
      }
      
      // Add status indicator
      let statusHtml = '';
      if (status === "completed") {
        statusHtml = '<span class="status completed" title="Transcription completed">✓</span>';
      } else if (status === "pending") {
        statusHtml = '<span class="status pending" title="Transcription in progress">⌛</span>';
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

// Updated function to play audio and show transcription
function playAudioWithTranscription(audioFile, displayName, transcriptionId) {
  console.log(`Playing ${audioFile} with transcription ID: ${transcriptionId}`);
  
  // Show audio player
  playerContainer.style.display = "block";
  playerContainer.classList.add("visible");
  currentFileName.textContent = displayName;
  
  // Set source and prepare player
  const fullAudioPath = path.join(audioPath, audioFile);
  console.log("Loading audio from:", fullAudioPath);
  audioPlayer.src = `file://${fullAudioPath}`;
  audioPlayer.load(); // Force reload
  
  // Reset UI
  playButton.textContent = "▶";
  progressBarFill.style.width = "0%";
  timeDisplay.textContent = "00:00 / 00:00";
  
  // Show transcription container
  transcriptionContainer.classList.add("visible");
  
  // Load and display transcription if available
  if (transcriptionId) {
    const transcriptionFile = `transcription-${transcriptionId}.json`;
    const transcriptionPath = path.join(transcriptionsPath, transcriptionFile);
    
    console.log(`Looking for transcription at: ${transcriptionPath}`);
    console.log(`File exists: ${fs.existsSync(transcriptionPath)}`);
    
    if (fs.existsSync(transcriptionPath)) {
      try {
        const content = fs.readFileSync(transcriptionPath, 'utf8');
        console.log(`Transcription content length: ${content.length} bytes`);
        
        const data = JSON.parse(content);
        transcriptionText.textContent = data.text || "No text in transcription";
        console.log("Displayed transcription:", data.text?.substring(0, 100));
      } catch (err) {
        console.error("Error loading transcription file:", err);
        transcriptionText.textContent = `Error loading transcription: ${err.message}`;
      }
    } else {
      // Try to get from server
      transcriptionText.textContent = "Fetching transcription from server...";
      
      fetch(`http://localhost:3000/transcription/${transcriptionId}/details`)
        .then(response => {
          if (!response.ok) throw new Error(`HTTP error ${response.status}`);
          return response.json();
        })
        .then(data => {
          transcriptionText.textContent = data.text || "No text in transcription";
          
          // Save locally for next time
          if (!fs.existsSync(transcriptionsPath)) {
            fs.mkdirSync(transcriptionsPath, { recursive: true });
          }
          fs.writeFileSync(transcriptionPath, JSON.stringify(data, null, 2));
        })
        .catch(err => {
          console.error("Error fetching transcription:", err);
          transcriptionText.textContent = `Error fetching transcription: ${err.message}`;
        });
    }
  } else {
    transcriptionText.textContent = "No transcription available for this audio";
  }
}

function selectFile(fileItem) {
  // Remove selected class from all items
  document.querySelectorAll(".file-item").forEach(item => {
    item.classList.remove("selected");
  });
  
  // Add selected class to clicked item
  fileItem.classList.add("selected");
  
  const audioFile = fileItem.dataset.audioFile;
  const status = fileItem.dataset.status;
  const transcriptionFile = fileItem.dataset.transcriptionFile;
  
  // Show audio player
  playerContainer.classList.add("visible");
  currentFileName.textContent = new Date(extractTimestamp(audioFile)).toLocaleString();
  
  // Reset audio player
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  
  // Set source and prepare player
  audioPlayer.src = `file://${path.join(audioPath, audioFile)}`;
  playButton.textContent = "▶";
  progressBarFill.style.width = "0%";
  timeDisplay.textContent = "00:00 / 00:00";
  
  // Clear the waveform
  if (waveformContext) {
    waveformContext.fillStyle = "#222";
    waveformContext.fillRect(0, 0, waveformCanvas.width, waveformCanvas.height);
  }
  
  // Show transcription if available
  if (status === "completed" && transcriptionFile) {
    try {
      const transcriptionData = JSON.parse(fs.readFileSync(transcriptionFile, "utf8"));
      transcriptionContainer.classList.add("visible");
      transcriptionText.textContent = transcriptionData.text || "No text in transcription";
    } catch (error) {
      console.error("Error reading transcription:", error);
      transcriptionContainer.classList.add("visible");
      transcriptionText.textContent = `Error loading transcription: ${error.message}`;
    }
  } else if (status === "pending") {
    transcriptionContainer.classList.add("visible");
    transcriptionText.textContent = "Transcription is still processing...";
  } else {
    transcriptionContainer.classList.add("visible");
    transcriptionText.textContent = "No transcription available for this audio";
  }
}

function extractTimestamp(filename) {
  try {
    // Extract timestamp from filename format like "recording-2023-02-24T12-34-56-789Z.webm"
    const match = filename.match(/recording-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
    if (match && match[1]) {
      // Convert to ISO format by replacing hyphens with colons only in the time part (after T)
      const isoTimestamp = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3');
      return isoTimestamp;
    }
  } catch (e) {
    console.error("Error extracting timestamp:", e);
  }
  return null;
}

// Refresh every 30 seconds to check for new files or status changes
setInterval(loadAudioFiles, 30000);

// Function to toggle play/pause
function togglePlay() {
  if (audioPlayer.paused) {
    audioPlayer.play();
    if (!audioContext) {
      setupAudioVisualizer();
    }
  } else {
    audioPlayer.pause();
  }
}

// Function to seek in the audio file
function seekAudio(e) {
  const percent = e.offsetX / progressBar.offsetWidth;
  audioPlayer.currentTime = percent * audioPlayer.duration;
  progressBarFill.style.width = `${percent * 100}%`;
}

// Function to update progress bar and time display
function updateProgress() {
  const percent = (audioPlayer.currentTime / audioPlayer.duration) * 100;
  progressBarFill.style.width = `${percent}%`;
  
  // Format current time and duration
  const currentTime = formatTime(audioPlayer.currentTime);
  const duration = formatTime(audioPlayer.duration);
  timeDisplay.textContent = `${currentTime} / ${duration}`;
}

// Function to format time in MM:SS format
function formatTime(seconds) {
  if (isNaN(seconds)) return "00:00";
  
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

// Setup audio visualizer for waveform
function setupAudioVisualizer() {
  // Create audio context
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  
  // Create audio source from the audio element
  audioSource = audioContext.createMediaElementSource(audioPlayer);
  
  // Create analyser
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  
  // Connect source to analyser and then to destination (speakers)
  audioSource.connect(analyser);
  analyser.connect(audioContext.destination);
  
  // Create data array for analyser
  dataArray = new Uint8Array(analyser.frequencyBinCount);
  
  // Start visualization
  drawWaveform();
}

// Draw waveform visualization
function drawWaveform() {
  if (!audioContext || audioPlayer.paused) return;
  
  requestAnimationFrame(drawWaveform);
  
  // Get canvas dimensions
  const width = waveformCanvas.width;
  const height = waveformCanvas.height;
  
  // Clear canvas
  waveformContext.fillStyle = "#222";
  waveformContext.fillRect(0, 0, width, height);
  
  // Get audio data
  analyser.getByteTimeDomainData(dataArray);
  
  // Draw waveform
  waveformContext.lineWidth = 2;
  waveformContext.strokeStyle = "#4285f4";
  waveformContext.beginPath();
  
  const sliceWidth = width / dataArray.length;
  let x = 0;
  
  for (let i = 0; i < dataArray.length; i++) {
    const v = dataArray[i] / 128.0;
    const y = v * height / 2;
    
    if (i === 0) {
      waveformContext.moveTo(x, y);
    } else {
      waveformContext.lineTo(x, y);
    }
    
    x += sliceWidth;
  }
  
  waveformContext.lineTo(width, height / 2);
  waveformContext.stroke();
}

// Add window resize event listener
window.addEventListener("resize", () => {
  if (waveformCanvas) {
    waveformCanvas.width = waveformCanvas.offsetWidth;
    waveformCanvas.height = waveformCanvas.offsetHeight;
  }
}); 