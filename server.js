const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';  // Required for Railway / cloud hosting
const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));
app.get("/room/:roomId", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

/* ── helpers ───────────────────────────────────────── */
function mkRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      users: new Map(),       // socketId → { id, name }
      activePair: [],         // [leftId, rightId]
      votes: { left: 0, right: 0 },
      votedBy: new Set(),
      scoreboard: {},         // socketId → wins
      roundActive: false
    });
  }
  return rooms.get(roomId);
}

function snapshot(roomId) {
  const room = getRoom(roomId);
  const [lId, rId] = room.activePair;
  return {
    roomId,
    users: [...room.users.values()],
    activePair: {
      left:  lId ? room.users.get(lId)  ?? null : null,
      right: rId ? room.users.get(rId) ?? null : null
    },
    votes: { ...room.votes },
    scoreboard: { ...room.scoreboard }
  };
}

function pickPair(room) {
  const ids = [...room.users.keys()];
  // Always put at least 1 user on left so their camera is visible while waiting
  if (ids.length === 0)      room.activePair = [];
  else if (ids.length === 1) room.activePair = [ids[0]];
  else                       room.activePair = [ids[0], ids[1]];
  room.votes = { left: 0, right: 0 };
  room.votedBy.clear();
  room.roundActive = ids.length >= 2;
}

function rotatePair(room) {
  const ids = [...room.users.keys()];
  if (ids.length < 2) return;
  // Move first user to end (Map preserves insertion order)
  const first = ids[0];
  const data  = room.users.get(first);
  room.users.delete(first);
  room.users.set(first, data);
  pickPair(room);
}

function broadcast(roomId) {
  io.to(roomId).emit("room-state", snapshot(roomId));
}

function finishRound(roomId) {
  const room = getRoom(roomId);
  const [lId, rId] = room.activePair;
  if (!lId || !rId) return;

  room.roundActive = false;
  let winnerId = null;
  if (room.votes.left  > room.votes.right) winnerId = lId;
  if (room.votes.right > room.votes.left)  winnerId = rId;

  if (winnerId) {
    room.scoreboard[winnerId] = (room.scoreboard[winnerId] || 0) + 1;
  }

  io.to(roomId).emit("round-result", {
    winner: winnerId ? room.users.get(winnerId) ?? null : null,
    votes: { ...room.votes }
  });
  broadcast(roomId);
}

/* ── socket events ─────────────────────────────────── */
io.on("connection", (socket) => {

  socket.on("create-room", (cb) => {
    let id = mkRoomId();
    while (rooms.has(id)) id = mkRoomId();
    getRoom(id);
    cb({ roomId: id });
  });

  socket.on("join-room", ({ roomId, name }, cb) => {
    const rid  = String(roomId || "").trim().toUpperCase();
    const uname = String(name || "Guest").trim().slice(0, 24) || "Guest";

    if (!rid) return cb({ ok: false, error: "Room code required." });

    const room = getRoom(rid);
    socket.join(rid);
    socket.data.roomId = rid;
    socket.data.name   = uname;

    room.users.set(socket.id, { id: socket.id, name: uname });
    if (room.activePair.length < 2) pickPair(room);

    cb({ ok: true, selfId: socket.id, room: snapshot(rid) });
    socket.to(rid).emit("user-joined", { id: socket.id, name: uname });
    broadcast(rid);
  });

  socket.on("signal", ({ to, data }) => {
    if (to && data) io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("vote", ({ side }) => {
    const rid = socket.data.roomId;
    if (!rid || !["left","right"].includes(side)) return;

    const room = getRoom(rid);
    if (!room.roundActive)         return;
    if (room.votedBy.has(socket.id)) return;
    if (room.activePair.length < 2)  return;

    room.votedBy.add(socket.id);
    room.votes[side]++;
    broadcast(rid);

    // Auto-finish when everyone has voted
    if (room.votedBy.size >= room.users.size) finishRound(rid);
  });

  socket.on("next-round", () => {
    const rid = socket.data.roomId;
    if (!rid) return;
    const room = getRoom(rid);
    if (room.users.size < 2) return;
    rotatePair(room);
    broadcast(rid);
  });

  socket.on("disconnect", () => {
    const rid = socket.data.roomId;
    if (!rid || !rooms.has(rid)) return;

    const room = rooms.get(rid);
    room.users.delete(socket.id);
    room.votedBy.delete(socket.id);

    if (room.users.size === 0) { rooms.delete(rid); return; }

    socket.to(rid).emit("user-left", socket.id);

    if (room.activePair.includes(socket.id)) pickPair(room);
    else if (room.votedBy.size >= room.users.size && room.roundActive) {
      finishRound(rid);
    }
    broadcast(rid);
  });
});

server.listen(PORT, HOST, () =>
  console.log(`Live Mogging running → http://${HOST}:${PORT}`)
);
