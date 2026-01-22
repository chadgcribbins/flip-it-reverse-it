# Flip It & Reverse It

**Status:** Live
**Deployment:** https://flip-it-reverse-it.vercel.app/
**Inspired by:** Missy Elliott & Braun design

## Overview

A vocal experimentation tool for recording audio, playing it in reverse, and attempting to mimic the reversed sound. Inspired by the technique used in "Work It" by Missy Elliott, this browser-based app lets you:

1. Record original audio (up to 120 seconds)
2. Play it forward or in reverse
3. Record your attempt to mimic the reversed audio
4. Compare by reversing your mimic attempt

Perfect for:
- Music production experimentation
- Vocal training and ear training
- Creating reversed vocals for tracks
- Having fun with phonetic reversals

## Features

### Original Panel
- **Record** - Capture up to 120 seconds of audio
- **Play** - Listen to your recording forward
- **Reverse** - Listen to the reversed audio
- **Download** - Save your original clip
- **Upload** - Load existing audio files

### Mimic Panel
- **Record** - Attempt to mimic the reversed sound
- **Play** - Listen to your mimic attempt forward
- **Reverse** - Hear your mimic attempt in reverse (reveals how accurate you were)
- **Download** - Save your mimic clip

### Design
- **Braun-inspired aesthetic** - Clean, functional, minimal design language
- **Visual feedback** - Real-time status indicators for recording/playback
- **Local storage** - Automatically saves your recordings between sessions
- **Responsive** - Works on desktop and mobile browsers

## Technical Details

- Pure vanilla JavaScript (no frameworks)
- Web Audio API for audio processing
- MediaRecorder API for recording
- Local storage for persistence
- CSS Grid for responsive layout
- IBM Plex Mono & Space Grotesk fonts

## Usage

1. **Record Something** - Click the red record button in "Original"
2. **Listen in Reverse** - Click the backward play button (◄)
3. **Try to Mimic** - While hearing the reverse, record yourself in "Mimic"
4. **Check Your Work** - Play your mimic in reverse to see how close you got!

## The Technique

This is the technique used in songs like:
- "Work It" by Missy Elliott - "put your thing down flip it and reverse it"
- "Fire on Babylon" by Sinéad O'Connor
- Various experimental music tracks

The key is learning to pronounce words/sounds in a way that, when reversed, sounds like natural speech or singing.

## Deployment

Deployed on Vercel:
- **Production:** https://flip-it-reverse-it.vercel.app/
- Automatically deploys from `main` branch
- Supports both personal and WE3 GitHub repos

## Project Structure

```
flip-it-and-reverse-it/
├── index.html       # Main app structure
├── app.js           # Audio recording/processing logic
├── styles.css       # Braun-inspired styling
└── favicon.svg      # App icon
```

## Browser Requirements

- Modern browser with Web Audio API support
- Microphone access required for recording
- Tested on Chrome, Firefox, Safari

---

**WE3 Venture Studio**
Playground for audio experimentation and vocal techniques.
