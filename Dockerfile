FROM verapdf/cli:v1.30.1 AS verapdf

FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends openjdk-17-jre-headless ca-certificates fontconfig \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV VERAPDF_BIN=/opt/verapdf/verapdf
ENV MAX_FILE_SIZE=52428800
ENV VERAPDF_TIMEOUT=120000
ENV PATH="/opt/verapdf:${JAVA_HOME}/bin:${PATH}"

WORKDIR /app

COPY --from=verapdf /opt/verapdf /opt/verapdf

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
