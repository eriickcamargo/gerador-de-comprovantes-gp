# Usa uma imagem oficial e leve do Node.js (versão 20 LTS)
FROM node:20-bookworm-slim

# Instala as bibliotecas de sistema necessárias para o Puppeteer gerar PDFs.
# Instalar o pacote 'chromium' puxa automaticamente todas as dependências gráficas necessárias no Debian.
# Instalamos também 'fonts-liberation' para garantir que os textos do recibo fiquem bonitos.
RUN apt-get update \
    && apt-get install -y chromium fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Define o diretório de trabalho dentro do contêiner
WORKDIR /app

# Copia apenas os arquivos de dependência primeiro (otimiza o cache e deixa o build mais rápido)
COPY package*.json ./

# Instala as dependências do projeto
RUN npm install

# Copia todo o resto do código da aplicação para o contêiner
COPY . .

# Garante que os diretórios necessários existem
RUN mkdir -p db temp

# Comando para iniciar o bot
CMD ["npm", "start"]
