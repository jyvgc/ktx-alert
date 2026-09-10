// 아주 가벼운 파일 기반 DB (lowdb) - 서버 재시작해도 데이터 유지
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

const adapter = new FileSync(path.join(__dirname, 'data', 'db.json'));
const db = low(adapter);

db.defaults({
  watches: [],      // 현재 감시 중인 예매 조건들
  favorites: [],    // 자주 쓰는 구간 즐겨찾기
  chats: [],        // 텔레그램에서 /start 를 입력한 chat_id 목록
  logs: []          // 알림 발송 이력
}).write();

module.exports = db;
