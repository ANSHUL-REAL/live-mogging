# Live Mogging Web App

A small browser-based app for private-room live video voting. It uses Node.js, Express, Socket.IO, and WebRTC with no database.

## Features

- Create or join private rooms with a room code
- Camera and microphone access through the browser
- Peer-to-peer video with WebRTC
- Socket.IO signaling for offers, answers, and ICE candidates
- Live left/right voting
- Instant round result and in-memory scoreboard

## Run Locally

```bash
npm install
npm start
```

Then open:

```text
http://localhost:3000
```

Use two browser windows or two devices on the same network to test voting and video.

## Notes

- Rooms and scores reset when the server restarts.
- Browser camera access generally requires `localhost` or HTTPS.
- The app is designed for small private groups.
