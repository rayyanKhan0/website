// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });

const PORT = 3000;
app.use(express.static(__dirname));

let games = {};

function createDeck() {
  const colors = ['red', 'green', 'blue', 'yellow'];
  const values = ['0','1','2','3','4','5','6','7','8','9','skip','reverse','draw2'];
  const deck = [];
  for (let color of colors) {
    for (let value of values) {
      deck.push({ color, value });
      if (value !== '0') deck.push({ color, value });
    }
  }
  ['wild', 'wilddraw4'].forEach(type => {
    for (let i = 0; i < 4; i++) deck.push({ color: 'black', value: type });
  });
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

io.on('connection', socket => {
  socket.on('join', ({ room, name }) => {
    socket.join(room);
    if (!games[room]) {
      games[room] = { players: [], deck: createDeck(), discard: [], turn: 0, direction: 1, ai: false };
    }
    const game = games[room];
    if (!game.players.find(p => p.id === socket.id)) {
      game.players.push({ id: socket.id, name, hand: [] });
    }
    if (game.players.length === 1 && !game.ai) {
      game.players.push({ id: 'AI', name: 'Computer', hand: [] });
      game.ai = true;
    }
    io.in(room).emit('players', game.players.map(p => p.name));
    if (game.players.every(p => p.hand.length === 0)) {
      shuffle(game.deck);
      for (let p of game.players) p.hand = game.deck.splice(0, 7);
      let firstCard;
      do { firstCard = game.deck.shift(); } while (firstCard.color === 'black');
      game.discard = [firstCard];
      game.turn = 0;
      io.in(room).emit('start', {
        hands: game.players.reduce((acc, p) => ({ ...acc, [p.id]: p.hand }), {}),
        discard: game.discard,
        turn: game.turn,
        players: game.players.map(p => p.name)
      });
    }
  });

  socket.on('play', ({ room, card, color }) => {
    const game = games[room];
    const player = game.players[game.turn];
    if (player.id !== socket.id && player.id !== 'AI') return;
    const top = game.discard[game.discard.length - 1];
    const valid = card.color === top.color || card.value === top.value || card.color === 'black';
    if (!valid) return;
    player.hand = player.hand.filter(c => !(c.color === card.color && c.value === card.value));
    if (card.color === 'black' && color) card.chosen = color;
    game.discard.push(card);
    let skip = false, draw = 0;
    if (card.value === 'reverse') game.direction *= -1;
    if (card.value === 'skip') skip = true;
    if (card.value === 'draw2') draw = 2;
    if (card.value === 'wilddraw4') draw = 4;
    let next = (game.turn + game.direction + game.players.length) % game.players.length;
    if (skip) next = (next + game.direction + game.players.length) % game.players.length;
    if (draw) {
      const target = game.players[next];
      target.hand.push(...game.deck.splice(0, draw));
      next = (next + game.direction + game.players.length) % game.players.length;
    }
    game.turn = next;
    if (player.hand.length === 0) {
      io.in(room).emit('win', player.name);
      delete games[room];
      return;
    }
    io.in(room).emit('update', {
      hands: game.players.reduce((acc, p) => ({ ...acc, [p.id]: p.hand }), {}),
      discard: game.discard,
      turn: game.turn
    });
    if (game.players[game.turn].id === 'AI') setTimeout(() => aiPlay(room), 1000);
  });

  socket.on('draw', ({ room }) => {
    const game = games[room];
    const player = game.players[game.turn];
    if (player.id !== socket.id && player.id !== 'AI') return;
    player.hand.push(game.deck.shift());
    io.in(room).emit('update', {
      hands: game.players.reduce((acc, p) => ({ ...acc, [p.id]: p.hand }), {}),
      discard: game.discard,
      turn: game.turn
    });
    if (game.players[game.turn].id === 'AI') setTimeout(() => aiPlay(room), 1000);
  });

  socket.on('disconnect', () => {
    for (const room in games) {
      const game = games[room];
      const idx = game.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        game.players.splice(idx, 1);
        io.in(room).emit('players', game.players.map(p => p.name));
        if (game.players.length < 2) delete games[room];
      }
    }
  });
});

function aiPlay(room) {
  const game = games[room];
  if (!game) return;
  const ai = game.players[game.turn];
  const top = game.discard[game.discard.length - 1];
  let playable = ai.hand.filter(c =>
    c.color === top.color ||
    c.value === top.value ||
    c.color === 'black' ||
    (top.color === 'black' && c.color === top.chosen)
  );
  if (playable.length > 0) {
    let card = playable[0];
    let color = card.color === 'black'
      ? ai.hand.filter(c => c.color !== 'black')[0]?.color || 'red'
      : undefined;
    io.emit('play', { room, card, color });
  } else {
    io.emit('draw', { room });
  }
}

http.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
