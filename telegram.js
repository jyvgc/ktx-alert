// 텔레그램 봇 연결 및 메시지 발송 담당 (사용자별 분리 지원)
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.warn('[경고] TELEGRAM_BOT_TOKEN이 설정되지 않았습니다. .env 파일을 확인하세요.');
}

const bot = token ? new TelegramBot(token, { polling: true }) : null;

// 6자리 랜덤 연결 코드 생성 (웹페이지에서 본인 확인용)
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

if (bot) {
  // 사용자가 텔레그램 봇에게 /start 를 보내면 chat_id를 등록하고
  // 웹페이지에 입력할 "연결 코드"를 발급한다.
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    let chat = db.get('chats').find({ chatId }).value();

    if (!chat) {
      chat = {
        chatId,
        code: generateCode(),
        joinedAt: new Date().toISOString(),
      };
      db.get('chats').push(chat).write();
    }

    bot.sendMessage(
      chatId,
      `✅ 연결되었습니다!\n\n` +
      `아래 6자리 코드를 웹페이지(감시 등록 화면)에 딱 한 번 입력하면, ` +
      `이 텔레그램으로만 내 감시 구간의 알림을 받을 수 있습니다.\n\n` +
      `🔑 연결 코드: ${chat.code}\n\n` +
      `코드는 언제든 /code 로 다시 확인할 수 있습니다.`
    );
  });

  bot.onText(/\/code/, (msg) => {
    const chatId = msg.chat.id;
    const chat = db.get('chats').find({ chatId }).value();
    if (!chat) {
      bot.sendMessage(chatId, '먼저 /start 를 입력해주세요.');
      return;
    }
    bot.sendMessage(chatId, `🔑 내 연결 코드: ${chat.code}`);
  });

  bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    const chat = db.get('chats').find({ chatId }).value();
    if (!chat) {
      bot.sendMessage(chatId, '먼저 /start 를 입력해주세요.');
      return;
    }
    const watches = db.get('watches').filter({ userId: chat.chatId, active: true }).value();
    if (watches.length === 0) {
      bot.sendMessage(chatId, '현재 내가 감시 중인 구간이 없습니다.');
      return;
    }
    const lines = watches.map(
      (w, i) => `${i + 1}. ${w.from} → ${w.to} / ${w.date} ${w.timeFrom}~${w.timeTo}`
    );
    bot.sendMessage(chatId, `내가 감시 중인 구간:\n${lines.join('\n')}`);
  });
}

// 연결 코드로 chatId 조회 (웹페이지에서 코드 입력 시 사용)
function findChatByCode(code) {
  return db.get('chats').find({ code: String(code) }).value();
}

// 특정 chatId 한 명에게만 메시지 전송 (사용자별 분리 알림)
function sendToChat(chatId, text) {
  if (!bot) {
    console.log(`[텔레그램 미설정] (chat ${chatId}) 알림 내용:`, text);
    return;
  }
  bot.sendMessage(chatId, text).catch((err) => {
    console.error('텔레그램 전송 실패:', chatId, err.message);
  });
}

module.exports = { bot, findChatByCode, sendToChat };
