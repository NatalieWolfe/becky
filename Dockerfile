FROM node:18 AS install

RUN adduser becky
USER becky
WORKDIR /becky

ENV PGHOST postgres
ENV SQLITE_DB_PATH becky.sqlite

COPY --chown=becky:becky package.json .
COPY --chown=becky:becky package-lock.json .
RUN npm install

COPY --chown=becky:becky tsconfig.json .
COPY --chown=becky:becky src ./src
RUN npm run compile

CMD ["npm", "start"]
