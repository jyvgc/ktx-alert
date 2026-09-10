// 아주 가벼운 파일 기반 DB (lowdb) - 서버 재시작해도 데이터 유지
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'db.json');

// data 폴더나 db.json 파일이 없으면(예: 새 서버/컨테이너 최초 실행) 미리 만들어둔다.
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, JSON.stringify({ watches: [], favorites: [], chats: [], logs: [] }, null, 2));
}

const adapter = new FileSync(dbPath);
const db = low(adapter);

db.defaults({
  watches: [],      // 현재 감시 중인 예매 조건들
  favorites: [],    // 자주 쓰는 구간 즐겨찾기
  chats: [],        // 텔레그램에서 /start 를 입력한 chat_id 목록
  logs: []          // 알림 발송 이력
}).write();

module.exports = db;
