require('dotenv').config();

const { initDB } = require('./src/database/db');
const { startBot } = require('./src/bot/handlers');

// Validação de variáveis obrigatórias
const required = ['TELEGRAM_BOT_TOKEN', 'GEMINI_API_KEY'];
const missing = required.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`❌ Variáveis de ambiente ausentes: ${missing.join(', ')}`);
  console.error('Crie o arquivo .env a partir do .env.example e preencha os valores.');
  process.exit(1);
}

async function main() {
  try {
    await initDB();
    startBot();
    console.log('✅ Sistema de recibos PIX iniciado com sucesso!');
    console.log('📱 Aguardando comprovantes no Telegram...');
  } catch (err) {
    console.error('❌ Erro fatal ao iniciar:', err);
    process.exit(1);
  }
}

// Tratamento gracioso de erros não capturados
process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});

main();
