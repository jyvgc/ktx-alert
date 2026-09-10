# Playwright 공식 이미지: 브라우저 실행에 필요한 시스템 라이브러리가 이미 설치되어 있어
# Render 같은 무료 호스팅에서도 별도 관리자 권한 문제 없이 바로 실행 가능
FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# 혹시 모를 브라우저 버전 불일치 방지용 재확인 설치 (이미지에 포함되어 있어 보통 매우 빠름)
RUN npx playwright install chromium

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]
