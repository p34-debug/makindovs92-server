const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log('Makindovs92 Server запущен на порту', PORT);

const clients = new Map();     // user -> ws
const history = new Map();     // user -> [messages]

wss.on('connection', (ws) => {
  let currentUser = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    // === РЕГИСТРАЦИЯ ===
    if (msg.type === 'register') {
      const user = (msg.user || '').trim();
      if (!user) return;

      // Если такой ник уже занят — отказываем
      if (clients.has(user)) {
        ws.send(JSON.stringify({ type: 'error', text: 'Ник уже занят' }));
        return;
      }

      currentUser = user;
      clients.set(user, ws);

      ws.send(JSON.stringify({
        type: 'registered',
        user: user,
        users: Array.from(clients.keys())
      }));

      // Оповещаем остальных — новый юзер в сети
      broadcast({
        type: 'user-joined',
        user: user,
        users: Array.from(clients.keys())
      }, user);

      console.log('+ Подключился:', user);
      return;
    }

    // === СООБЩЕНИЕ ===
    if (msg.type === 'message') {
      if (!currentUser) return;
      const to = (msg.to || '').trim();
      const text = (msg.text || '').trim();
      if (!to || !text) return;

      const packet = {
        type: 'message',
        from: currentUser,
        to: to,
        text: text,
        time: Date.now()
      };

      // Сохраняем в истории (у обоих)
      pushHistory(currentUser, packet);
      pushHistory(to, packet);

      // Отправляем получателю (если онлайн)
      const target = clients.get(to);
      if (target && target.readyState === WebSocket.OPEN) {
        target.send(JSON.stringify(packet));
      }

      // Отправляем отправителю (для подтверждения)
      ws.send(JSON.stringify(packet));
      return;
    }

    // === ЗАПРОС ИСТОРИИ ===
    if (msg.type === 'history') {
      if (!currentUser) return;
      const withUser = (msg.with || '').trim();
      const key = chatKey(currentUser, withUser);
      ws.send(JSON.stringify({
        type: 'history',
        with: withUser,
        messages: history.get(key) || []
      }));
      return;
    }

    // === СПИСОК ЮЗЕРОВ ===
    if (msg.type === 'users') {
      ws.send(JSON.stringify({
        type: 'users',
        users: Array.from(clients.keys())
      }));
      return;
    }

    // === PING (keep-alive) ===
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }
  });

  ws.on('close', () => {
    if (currentUser) {
      clients.delete(currentUser);
      broadcast({
        type: 'user-left',
        user: currentUser,
        users: Array.from(clients.keys())
      });
      console.log('- Отключился:', currentUser);
    }
  });

  ws.on('error', (err) => {
    console.error('WS error:', err.message);
  });
});

function broadcast(packet, exceptUser) {
  const data = JSON.stringify(packet);
  for (const [user, client] of clients) {
    if (user === exceptUser) continue;
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function chatKey(a, b) {
  return [a, b].sort().join('|||');
}

function pushHistory(user, packet) {
  const key = chatKey(packet.from, packet.to);
  if (!history.has(key)) history.set(key, []);
  const arr = history.get(key);
  arr.push(packet);
  // Храним последние 200 сообщений
  if (arr.length > 200) arr.shift();
}

// ===== HTTP health-check (Render требует) =====
const http = require('http');
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Makindovs92 Server OK');
});
httpServer.listen(PORT + 1, () => {
  console.log('HTTP health-check на порту', PORT + 1);
});
