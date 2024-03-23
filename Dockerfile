FROM node:18

RUN adduser becky
USER becky
WORKDIR /becky

ENV PGHOST postgres
ENV SQLITE_DB_PATH becky.sqlite
ENV SECRETS_DIR /becky/secrets
ENV DEBUG *

COPY --chown=becky:becky package.json .
COPY --chown=becky:becky package-lock.json .
RUN npm install --omit dev

COPY --chown=becky:becky tsconfig.json .
COPY --chown=becky:becky src ./src
RUN npm run compile

CMD ["npm", "start"]
