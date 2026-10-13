FROM node:22-alpine
WORKDIR /app/backend-web
COPY backend-web/package*.json ./
RUN npm install --omit=dev
COPY backend-web/ ./
COPY database/init.sql ./src/db/base.sql
COPY database/init.sql /app/database/init.sql
COPY frontend/ /app/frontend/
EXPOSE 5000
CMD ["npm","start"]
