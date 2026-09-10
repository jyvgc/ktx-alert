require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const db = require('./db');
const { findChatByCode, sendToChat } = require('./telegram');
const { checkAvailability } = require('./scraper');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const POLL_SECONDS = parseInt(process.env.POLL_INTERVAL_SECONDS || '40', 10);

// ---------- 사용자 식별 ----------
// 웹페이지가 매 요청마다 헤더 x-user-id 에 자신의 텔레그램 chatId를 실어 보낸다.
// (연결 코드를 통해 /api/link 로 한 번 발급받아 브라우저에 저장해둔 값)
function requireUser(req, res, next) {
  const userId = req.header('x-user-id');
  if (!userId) {
    return res.status(401).json({ error: '텔레그램 연결이 필요합니다. 먼저 연결 코드를 입력해주세요.' });
  }
  const chat = db.get('chats').find({ chatId: Number(userId) }).value();
  if (!chat) {
    return res.status(401).json({ error: '유효하지 않은 사용자입니다. 연결 코드를 다시 확인해주세요.' });
  }
  req.userId = chat.chatId;
  next();
}

// ---------- 텔레그램 연결 코드 확인 API ----------
app.post('/api/link', (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: '코드를 입력해주세요.' });
  const chat = findChatByCode(code);
  if (!chat) return res.status(404).json({ error: '코드가 일치하지 않습니다. 텔레그램에서 /code 로 다시 확인해주세요.' });
  res.json({ userId: chat.chatId });
});

app.get('/api/whoami', requireUser, (req, res) => {
  res.json({ userId: req.userId });
});

// ---------- 감시 조건(watches) API : 본인 것만 조회/등록/삭제 ----------

app.get('/api/watches', requireUser, (req, res) => {
  res.json(db.get('watches').filter({ userId: req.userId }).value());
});

app.post('/api/watches', requireUser, (req, res) => {
  const { from, to, date, timeFrom, timeTo, seatType } = req.body;
  if (!from || !to || !date) {
    return res.status(400).json({ error: 'from, to, date는 필수입니다.' });
  }
  const watch = {
    id: uuidv4(),
    userId: req.userId,
    from,
    to,
    date,
    timeFrom: timeFrom || '00:00',
    timeTo: timeTo || '23:59',
    seatType: seatType || '일반실',
    active: true,
    notifiedTrains: [], // 이미 알림을 보낸 열차는 중복 알림 방지
    createdAt: new Date().toISOString(),
  };
  db.get('watches').push(watch).write();
  res.json(watch);
});

// 감시 중지/삭제 (본인 소유만 가능)
app.delete('/api/watches/:id', requireUser, (req, res) => {
  const watch = db.get('watches').find({ id: req.params.id, userId: req.userId }).value();
  if (!watch) return res.status(404).json({ error: '해당 감시 항목을 찾을 수 없습니다.' });
  db.get('watches').remove({ id: req.params.id }).write();
  res.json({ ok: true });
});

app.patch('/api/watches/:id', requireUser, (req, res) => {
  const watch = db.get('watches').find({ id: req.params.id, userId: req.userId }).value();
  if (!watch) return res.status(404).json({ error: '해당 감시 항목을 찾을 수 없습니다.' });
  db.get('watches').find({ id: req.params.id }).assign(req.body).write();
  res.json({ ok: true });
});

// ---------- 즐겨찾기(자주 쓰는 구간) API : 본인 것만 ----------

app.get('/api/favorites', requireUser, (req, res) => {
  res.json(db.get('favorites').filter({ userId: req.userId }).value());
});

app.post('/api/favorites', requireUser, (req, res) => {
  const { name, from, to } = req.body;
  if (!from || !to) return res.status(400).json({ error: 'from, to는 필수입니다.' });
  const fav = { id: uuidv4(), userId: req.userId, name: name || `${from} → ${to}`, from, to };
  db.get('favorites').push(fav).write();
  res.json(fav);
});

app.delete('/api/favorites/:id', requireUser, (req, res) => {
  const fav = db.get('favorites').find({ id: req.params.id, userId: req.userId }).value();
  if (!fav) return res.status(404).json({ error: '해당 즐겨찾기를 찾을 수 없습니다.' });
  db.get('favorites').remove({ id: req.params.id }).write();
  res.json({ ok: true });
});

// ---------- 알림 로그 : 본인 것만 ----------
app.get('/api/logs', requireUser, (req, res) => {
  res.json(db.get('logs').filter({ userId: req.userId }).takeRight(50).value());
});

// ---------- 핵심: 주기적으로 좌석 확인 (모든 사용자의 감시 조건을 순회) ----------
let isChecking = false;

async function runCheckCycle() {
  if (isChecking) return; // 중복 실행 방지
  isChecking = true;

  const watches = db.get('watches').filter({ active: true }).value();

  for (const watch of watches) {
    try {
      const results = await checkAvailability(watch);
      const available = results.filter((r) => r.status === 'available');

      for (const train of available) {
        const key = `${train.trainNo}_${train.depTime}`;
        if (watch.notifiedTrains.includes(key)) continue; // 이미 알린 열차는 건너뜀

        const text =
          `🚄 취소표 발생!\n` +
          `${watch.from} → ${watch.to} (${watch.date})\n` +
          `열차: ${train.trainNo} / 출발 ${train.depTime}\n` +
          `좌석: ${watch.seatType}\n` +
          `지금 바로 코레일 앱/사이트에서 예매하세요!`;

        // 이 감시조건을 등록한 사용자(userId=chatId) 에게만 알림 전송
        sendToChat(watch.userId, text);

        db.get('logs')
          .push({ time: new Date().toISOString(), userId: watch.userId, watchId: watch.id, text })
          .write();

        db.get('watches')
          .find({ id: watch.id })
          .get('notifiedTrains')
          .push(key)
          .write();
      }
    } catch (err) {
      console.error('감시 조건 확인 중 오류:', watch, err.message);
    }
  }

  isChecking = false;
}

// node-cron은 최소 단위가 초 단위 표현식(6필드)을 지원 -> N초마다 실행
const cronExpr = `*/${POLL_SECONDS} * * * * *`;
cron.schedule(cronExpr, runCheckCycle);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`KTX 취소표 알림 서버 실행 중 → http://localhost:${PORT}`);
  console.log(`조회 주기: ${POLL_SECONDS}초`);
});
