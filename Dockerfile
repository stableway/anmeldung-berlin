FROM mcr.microsoft.com/playwright:v1.40.1-jammy

WORKDIR /home/pwuser/

COPY package.json .

RUN npm i

COPY . .

ENV NODE_OPTIONS="--max_old_space_size=4000 --max-http-header-size=80000"
ENV MAILSLURP_API_KEY=""

ENTRYPOINT [ "npm" ]

CMD [ "start" ]
