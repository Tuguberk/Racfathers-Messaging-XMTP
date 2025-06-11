# Aşama 1: Derleme
FROM node:20-bullseye AS builder
WORKDIR /app

# Bağımlılıkları kopyala ve yükle
COPY package*.json ./
RUN npm install

# Proje dosyalarını kopyala ve TypeScript'i derle
COPY . .
RUN npx tsc

# Aşama 2: Çalıştırma
FROM node:20-bullseye
WORKDIR /app

# Yalnızca gerekli dosyaları kopyala (örneğin derlenmiş js dosyaları ve package dosyaları)
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Runtime bağımlılıklarını yükle
RUN npm install --only=production

# Uygulama başlangıç komutu
CMD ["npm", "start"]