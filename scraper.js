// 코레일 승차권예매(korail.com) 사이트에서 실시간으로 좌석 잔여 여부를 확인하는 모듈
//
// ⚠️ 매우 중요 ⚠️
// 코레일 홈페이지는 리뉴얼이 잦아서 화면의 HTML 구조(선택자)가 바뀔 수 있습니다.
// 아래 SELECTORS 부분은 "이 자리를 코드에서 어떻게 찾는지"를 정의하는 곳인데,
// 지금 이 값이 실제 배포 시점의 코레일 화면과 다를 수 있습니다.
// => 만약 조회가 안 되면, 크롬 개발자도구(F12)로 검색 결과 페이지를 열어
//    아래 SELECTORS 값을 실제 화면에 맞게 한 번만 수정해주면 됩니다. (README 참고)

const { chromium } = require('playwright');

const BASE_URL = 'https://www.korail.com/ticket/reserve/timeTable';

// 화면 구조가 바뀌면 이 부분만 고치면 되도록 한 곳에 모아둠
const SELECTORS = {
  departureInput: 'input[name="dptRsStnCdNm"], input[placeholder*="출발"]',
  arrivalInput: 'input[name="arvRsStnCdNm"], input[placeholder*="도착"]',
  dateInput: 'input[name="dptDt"], input[placeholder*="날짜"]',
  searchButton: 'button:has-text("조회하기"), button:has-text("열차 조회")',
  resultRows: '.tbl_wrap tbody tr, .result-list li, table tbody tr',
  soldOutText: '매진',
  reserveText: '예약하기',
  waitingText: '예약대기',
};

/**
 * 지정한 구간/날짜/시간대의 예매 가능 여부를 조회한다.
 * @param {{from:string, to:string, date:string, timeFrom:string, timeTo:string, trainType?:string}} condition
 * @returns {Promise<Array<{trainNo:string, depTime:string, status:string, raw:string}>>}
 */
async function checkAvailability(condition) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage({ locale: 'ko-KR' });
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // 출발역/도착역/날짜 입력 (사이트 UI에 맞춰 자동완성 클릭이 필요할 수 있음)
    await page.fill(SELECTORS.departureInput, condition.from).catch(() => {});
    await page.fill(SELECTORS.arrivalInput, condition.to).catch(() => {});
    await page.fill(SELECTORS.dateInput, condition.date).catch(() => {});

    await page.click(SELECTORS.searchButton, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000); // 결과 렌더링 대기

    const rows = await page.$$(SELECTORS.resultRows);
    const results = [];

    for (const row of rows) {
      const raw = (await row.innerText()).trim();
      if (!raw) continue;

      // 시간대 필터 (예: 09:00 ~ 12:00 사이 출발 열차만 관심)
      const timeMatch = raw.match(/(\d{2}:\d{2})/);
      const depTime = timeMatch ? timeMatch[1] : null;
      if (condition.timeFrom && depTime && depTime < condition.timeFrom) continue;
      if (condition.timeTo && depTime && depTime > condition.timeTo) continue;

      let status = 'unknown';
      if (raw.includes(SELECTORS.soldOutText)) status = 'soldout';
      else if (raw.includes(SELECTORS.waitingText)) status = 'waiting';
      else if (raw.includes(SELECTORS.reserveText)) status = 'available';

      const trainNoMatch = raw.match(/(KTX[-\s]?\d+|SRT[-\s]?\d+|\d{3,4}열차)/);

      results.push({
        trainNo: trainNoMatch ? trainNoMatch[0] : '미확인',
        depTime: depTime || '미확인',
        status,
        raw,
      });
    }

    return results;
  } catch (err) {
    console.error(`[조회 실패] ${condition.from}->${condition.to} ${condition.date}:`, err.message);
    return [];
  } finally {
    await browser.close();
  }
}

module.exports = { checkAvailability };
