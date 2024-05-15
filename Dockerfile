FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /home/pwuser/

COPY package.json .

RUN npm i
RUN npx playwright install chrome

COPY . .

ENV NODE_ENV=production

ENTRYPOINT [ "npm" ]

CMD [ "start" ]
