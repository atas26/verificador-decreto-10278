FROM verapdf/cli:v1.30.1 AS verapdf

FROM node:20-alpine

ENV NODE_ENV=production
ENV PORT=3000
ENV VERAPDF_BIN=/opt/verapdf/verapdf
ENV MAX_FILE_SIZE=52428800
ENV VERAPDF_TIMEOUT=120000

WORKDIR /app

COPY --from=verapdf /opt/verapdf /opt/verapdf
ENV PATH="/opt/verapdf:${PATH}"

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
