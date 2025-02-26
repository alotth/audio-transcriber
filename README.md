# audio-transcriber

Transcribe audio files and records to text, using the best api for now to Portuguese. 4 simple projects used by me and my team to transcribe audio files and record the transcription to a database without credentials.

## Backend

Simple backend to transcribe audio files and record the transcription to a database without credentials.
Tech: Node.js, Express, SQLite
Issues: Get transcription with diarization, worked before.

## Electron

A client that can use the OS audio inputs and outputs to record audio and transcribe it sending the transcription to the backend.
Issues: Fix layout and add a better UI.

## Extension

Focused on google meet.
Issues: cant get the audio of the tab or system, only microphone.

## Scripts

Python scripts to send the file to the API and receive transcripts.
