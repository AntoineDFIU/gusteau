FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY deploy/gusteau_server.py ./deploy/gusteau_server.py
ENV GUSTEAU_HOST=0.0.0.0
ENV GUSTEAU_PORT=8080
ENV GUSTEAU_DIST=/app/dist
EXPOSE 8080
CMD ["python3", "deploy/gusteau_server.py"]
