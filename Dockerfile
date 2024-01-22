FROM mcr.microsoft.com/playwright:v1.40.1-jammy

WORKDIR /home/pwuser/

COPY package.json .

RUN npm i

COPY . .

ENV NODE_ENV=production

CMD [ "npm", "start" ]
