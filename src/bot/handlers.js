const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const { extractFromVoucher } = require('../ai/extractor');
const { generatePDF, generateStatementPDF, cleanupFile } = require('../pdf/generator');
const { findEmployee, saveEmployee } = require('../database/employees');
const { getCompany, saveCompany } = require('../database/company');
const { saveReceipt, listReceipts, getReceiptByNumber, searchReceiptsByEmployee, getReceiptsByEmployeeAndPeriod } = require('../database/receipts');
const { listEmployees } = require('../database/employees');
const { STATES, getState, setState, getData, setData, resetConversation } = require('./conversations');

const TEMP_DIR = path.join(__dirname, '../../temp');
const VALE_TYPES = ['Alimentação', 'Transporte', 'Refeição', 'Combustível', 'Adiantamento Salarial', 'Outro'];

/**
 * Escapa caracteres especiais do Markdown do Telegram (modo legacy).
 * Evita quebra de parsing ao inserir valores dinâmicos extraídos de documentos.
 */
function escapeMd(text) {
  if (!text) return '';
  return String(text).replace(/([*_`\[])/g, '\\$1');
}

// IDs de usuários autorizados (carregados do .env)
const ALLOWED_IDS = (process.env.ALLOWED_USER_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

function isAllowed(userId) {
  if (ALLOWED_IDS.length === 0) return true; // Se não configurado, permite todos (dev mode)
  return ALLOWED_IDS.includes(String(userId));
}

/**
 * Teclado inline para seleção de tipo de vale
 */
function valeKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🍽️ Alimentação', callback_data: 'vale_Alimentação' },
        { text: '🚌 Transporte', callback_data: 'vale_Transporte' },
      ],
      [
        { text: '🍴 Refeição', callback_data: 'vale_Refeição' },
        { text: '⛽ Combustível', callback_data: 'vale_Combustível' },
      ],
      [{ text: '💰 Adiantamento Salarial', callback_data: 'vale_Adiantamento Salarial' }],
      [{ text: '📋 Outro (digitar)', callback_data: 'vale_outro' }],
    ],
  };
}

/**
 * Baixa o arquivo enviado pelo usuário e salva no temp/
 */
async function downloadFile(bot, fileId, ext) {
  const fileInfo = await bot.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
  const destPath = path.join(TEMP_DIR, `voucher_${fileId}${ext}`);

  const response = await axios({ url: fileUrl, method: 'GET', responseType: 'stream' });
  const writer = fs.createWriteStream(destPath);
  response.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  return destPath;
}

/**
 * Processa o comprovante e faz o fluxo completo até gerar o recibo
 */
async function processVoucher(bot, chatId, userId, filePath) {
  try {
    await bot.sendMessage(chatId, '⏳ Analisando o comprovante com IA...');
    const extracted = await extractFromVoucher(filePath);
    cleanupFile(filePath);

    // Valida campos mínimos
    if (!extracted.nome_beneficiario || !extracted.valor) {
      return bot.sendMessage(
        chatId,
        '❌ Não consegui extrair os dados do comprovante.\n\n' +
        'Verifique se a imagem está nítida e tente novamente.\n' +
        'Se for PDF, certifique-se de que o arquivo não está corrompido.'
      );
    }

    // Salva dados extraídos no estado da conversa
    setData(userId, 'extracted', extracted);

    // Busca empresa salva
    const company = getCompany();
    setData(userId, 'company', company);

    // Verifica se empresa tem dados cadastrados
    if (!company || !company.name) {
      await bot.sendMessage(
        chatId,
        '⚠️ Você ainda não configurou os dados da empresa.\n' +
        'Use o comando /empresa para configurar antes de gerar recibos.'
      );
    }

    // Busca funcionário pelo nome extraído
    const employee = findEmployee(extracted.nome_beneficiario);

    let summaryMsg = `✅ *Dados extraídos do comprovante:*\n\n` +
      `👤 *Beneficiário:* ${escapeMd(extracted.nome_beneficiario)}\n` +
      `💰 *Valor:* ${escapeMd(extracted.valor)}\n` +
      `📅 *Data:* ${escapeMd(extracted.data)}${extracted.hora ? ' às ' + escapeMd(extracted.hora) : ''}\n`;

    if (extracted.chave_pix) summaryMsg += `🔑 *Chave PIX:* ${escapeMd(extracted.chave_pix)}\n`;
    if (extracted.agencia_conta) summaryMsg += `🏦 *Ag/Conta:* ${escapeMd(extracted.agencia_conta)}\n`;
    if (extracted.banco_beneficiario) summaryMsg += `🏛️ *Banco:* ${escapeMd(extracted.banco_beneficiario)}\n`;

    await bot.sendMessage(chatId, summaryMsg, { parse_mode: 'Markdown' });

    if (employee) {
      // Funcionário reconhecido
      setData(userId, 'employee', employee);
      await bot.sendMessage(
        chatId,
        `ℹ️ *Funcionário reconhecido!*\n` +
        `Cargo: *${escapeMd(employee.cargo)}* | Setor: *${escapeMd(employee.setor)}*\n\n` +
        `Selecione o tipo de vale:`,
        { parse_mode: 'Markdown', reply_markup: valeKeyboard() }
      );
      setState(userId, STATES.AWAITING_VALE_TYPE);
    } else {
      // Funcionário novo — coleta cargo
      await bot.sendMessage(
        chatId,
        `👤 Funcionário *${escapeMd(extracted.nome_beneficiario)}* não encontrado.\n\n` +
        `Qual é o *cargo* deste funcionário?`,

        { parse_mode: 'Markdown' }
      );
      setState(userId, STATES.AWAITING_CARGO);
    }
  } catch (err) {
    console.error('Erro ao processar comprovante:', err);
    cleanupFile(filePath);
    setState(userId, STATES.IDLE);
    bot.sendMessage(chatId, `❌ Erro ao processar: ${err.message}`);
  }
}

/**
 * Gera e envia o PDF do recibo
 */
async function finishAndSendReceipt(bot, chatId, userId) {
  const data = getData(userId);
  const extracted = data.extracted || {};
  const employee = data.employee || {};
  const company = data.company || {};

  setState(userId, STATES.PROCESSING);

  try {
    await bot.sendMessage(chatId, '⏳ Gerando o PDF do recibo...');

    // Gera número do recibo
    const receiptData = {
      companyName: company.name || 'EMPRESA',
      companyCnpj: company.cnpj || '',
      companyAddress: company.address || '',
      employeeName: extracted.nome_beneficiario,
      cargo: employee.cargo || data.cargo || '',
      setor: employee.setor || data.setor || '',
      amount: extracted.valor,
      valeType: data.valeType,
      paymentDate: extracted.data,
      paymentTime: extracted.hora,
      pixKey: extracted.chave_pix,
      agenciaConta: extracted.agencia_conta,
      transactionId: extracted.id_transacao,
      bankName: extracted.banco_beneficiario,
    };

    // Salva no DB para obter o número sequencial
    const savedReceipt = saveReceipt({
      employee_name: receiptData.employeeName,
      cargo: receiptData.cargo,
      setor: receiptData.setor,
      amount: receiptData.amount,
      vale_type: receiptData.valeType,
      payment_date: receiptData.paymentDate,
      payment_time: receiptData.paymentTime,
      pix_key: receiptData.pixKey,
      agencia_conta: receiptData.agenciaConta,
      transaction_id: receiptData.transactionId,
      bank_name: receiptData.bankName,
      company_name: receiptData.companyName,
      company_cnpj: receiptData.companyCnpj,
      telegram_user_id: String(userId),
    });

    receiptData.receiptNumber = savedReceipt.receipt_number;

    // Gera o PDF
    const pdfPath = await generatePDF(receiptData, savedReceipt.receipt_number);

    // Salva o caminho do PDF no histórico (opcional — para reenvio)
    // Não atualiza DB pois o PDF fica no temp e pode ser deletado

    // Salva/atualiza dados do funcionário
    if (!employee.id) {
      saveEmployee({
        name: extracted.nome_beneficiario,
        cargo: data.cargo,
        setor: data.setor,
      });
    }

    // Envia o PDF com contentType explícito (evita DeprecationWarning)
    await bot.sendDocument(
      chatId,
      fs.createReadStream(pdfPath),
      {
        caption:
          `✅ *Recibo Nº ${savedReceipt.receipt_number}*\n` +
          `👤 ${receiptData.employeeName}\n` +
          `💰 ${receiptData.amount} — Vale ${receiptData.valeType}\n` +
          `📅 ${receiptData.paymentDate}`,
        parse_mode: 'Markdown',
      },
      {
        filename: `recibo-${savedReceipt.receipt_number}.pdf`,
        contentType: 'application/pdf',
      }
    );

    // Limpa o PDF temporário após envio
    cleanupFile(pdfPath);

    resetConversation(userId);
    await bot.sendMessage(
      chatId,
      '✅ Recibo emitido com sucesso!\n\nEnvie outro comprovante quando quiser.'
    );
  } catch (err) {
    console.error('Erro ao gerar PDF:', err);
    setState(userId, STATES.IDLE);
    bot.sendMessage(chatId, `❌ Erro ao gerar o recibo: ${err.message}`);
  }
}

/**
 * Inicializa o bot e registra todos os handlers
 */
function startBot() {
  const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  console.log('🤖 Bot Telegram iniciado (polling)');

  // ─── /start ───────────────────────────────────────────────────────────────
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (!isAllowed(msg.from.id)) return;

    bot.sendMessage(
      chatId,
      `👋 *Olá! Sou o bot de emissão de recibos de vale via PIX.*\n\n` +
      `📋 *Como usar:*\n` +
      `1. Configure os dados da empresa com /empresa\n` +
      `2. Envie a foto ou PDF do comprovante PIX\n` +
      `3. Responda as perguntas do bot\n` +
      `4. Receba o PDF do recibo pronto para imprimir!\n\n` +
      `📌 *Comandos disponíveis:*\n` +
      `/empresa — Configurar dados da empresa\n` +
      `/historico [Qtd] — Ver últimos recibos (ex: /historico 20)\n` +
      `/buscar Nome — Buscar recibos de um funcionário\n` +
      `/extrato — Gerar extrato mensal de um funcionário\n` +
      `/cancelar — Cancelar operação atual`,
      { parse_mode: 'Markdown' }
    );
  });

  // ─── /extrato ──────────────────────────────────────────────────────────────
  bot.onText(/\/extrato/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!isAllowed(userId)) return;

    resetConversation(userId);
    setState(userId, STATES.AWAITING_EXTRATO_PERIOD);
    bot.sendMessage(
      chatId,
      `📊 *Extrato Mensal de Recibos*\n\n` +
      `Informe o *mês e ano* de referência no formato MM/AAAA\n` +
      `Exemplo: *04/2026*`,
      { parse_mode: 'Markdown' }
    );
  });

  // ─── /cancelar ────────────────────────────────────────────────────────────
  bot.onText(/\/cancelar/, (msg) => {
    const chatId = msg.chat.id;
    if (!isAllowed(msg.from.id)) return;
    resetConversation(msg.from.id);
    bot.sendMessage(chatId, '❌ Operação cancelada. Envie um comprovante quando quiser.');
  });

  // ─── /historico ───────────────────────────────────────────────────────────
  bot.onText(/\/historico(?:\s+(\d+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    if (!isAllowed(msg.from.id)) return;

    // Se o usuário digitou um número, usa ele. Caso contrário, padrão 10.
    const limit = match[1] ? parseInt(match[1], 10) : 10;
    
    // Limite razoável para não travar o celular com mensagem gigante
    const safeLimit = limit > 50 ? 50 : limit;

    const receipts = listReceipts(safeLimit);
    if (receipts.length === 0) {
      return bot.sendMessage(chatId, 'Nenhum recibo emitido ainda.');
    }

    let text = `📋 *Últimos ${receipts.length} recibos:*\n\n`;
    receipts.forEach((r, i) => {
      text += `${i + 1}. *${r.receipt_number}* — ${r.employee_name}\n`;
      text += `   💰 ${r.amount} | 🏷️ Vale ${r.vale_type} | 📅 ${r.payment_date}\n\n`;
    });

    text += `Para reenviar um recibo, use:\n/recibo NUMERO (ex: /recibo 202604-001)`;

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  // ─── /buscar ──────────────────────────────────────────────────────────────
  bot.onText(/\/buscar (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (!isAllowed(msg.from.id)) return;

    const searchQuery = match[1].trim();
    if (searchQuery.length < 2) {
      return bot.sendMessage(chatId, '⚠️ Digite pelo menos 2 letras do nome para buscar.');
    }

    const receipts = searchReceiptsByEmployee(searchQuery);
    if (receipts.length === 0) {
      return bot.sendMessage(chatId, `🔍 Nenhum recibo encontrado para *${searchQuery}*.`, { parse_mode: 'Markdown' });
    }

    let text = `🔍 *Resultados para "${searchQuery}":*\nEncontrados ${receipts.length} recibos recentes.\n\n`;
    receipts.forEach((r) => {
      text += `*${r.receipt_number}* — ${r.employee_name}\n`;
      text += `💰 ${r.amount} | 📅 ${r.payment_date}\n\n`;
    });

    text += `Use /recibo NUMERO para baixar o PDF.`;

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  // ─── /recibo ──────────────────────────────────────────────────────────────
  bot.onText(/\/recibo (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!isAllowed(msg.from.id)) return;

    const receiptNumber = match[1].trim();
    const receipt = getReceiptByNumber(receiptNumber);

    if (!receipt) {
      return bot.sendMessage(chatId, `❌ Recibo *${receiptNumber}* não encontrado.`, { parse_mode: 'Markdown' });
    }

    // Regera o PDF
    try {
      await bot.sendMessage(chatId, `⏳ Regenerando recibo ${receiptNumber}...`);
      const company = getCompany() || {};
      const receiptData = {
        receiptNumber: receipt.receipt_number,
        companyName: receipt.company_name || company.name || 'EMPRESA',
        companyCnpj: receipt.company_cnpj || company.cnpj || '',
        companyAddress: company.address || '',
        employeeName: receipt.employee_name,
        cargo: receipt.cargo,
        setor: receipt.setor,
        amount: receipt.amount,
        valeType: receipt.vale_type,
        paymentDate: receipt.payment_date,
        paymentTime: receipt.payment_time,
        pixKey: receipt.pix_key,
        agenciaConta: receipt.agencia_conta,
        transactionId: receipt.transaction_id,
        bankName: receipt.bank_name,
      };

      const pdfPath = await generatePDF(receiptData, receipt.receipt_number);
      await bot.sendDocument(
        chatId,
        fs.createReadStream(pdfPath),
        {
          caption: `✅ Recibo *${receiptNumber}* — ${receipt.employee_name}`,
          parse_mode: 'Markdown',
        },
        {
          filename: `recibo-${receiptNumber}.pdf`,
          contentType: 'application/pdf',
        }
      );
      cleanupFile(pdfPath);
    } catch (err) {
      bot.sendMessage(chatId, `❌ Erro ao gerar o recibo: ${err.message}`);
    }
  });

  // ─── /empresa ─────────────────────────────────────────────────────────────
  bot.onText(/\/empresa/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!isAllowed(userId)) return;

    const company = getCompany();
    if (company) {
      bot.sendMessage(
        chatId,
        `🏢 *Dados atuais da empresa:*\n` +
        `Nome: ${company.name || 'Não definido'}\n` +
        `CNPJ: ${company.cnpj || 'Não definido'}\n` +
        `Endereço: ${company.address || 'Não definido'}\n\n` +
        `Para atualizar, envie o nome da empresa:`,
        { parse_mode: 'Markdown' }
      );
    } else {
      bot.sendMessage(chatId, `🏢 Vamos cadastrar os dados da empresa.\n\nQual é o *nome* da empresa?`, { parse_mode: 'Markdown' });
    }

    setState(userId, STATES.AWAITING_EMPRESA_NAME);
  });

  // ─── Recebimento de fotos ─────────────────────────────────────────────────
  bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!isAllowed(userId)) return;

    const state = getState(userId);
    if (state !== STATES.IDLE) {
      return bot.sendMessage(chatId, '⚠️ Ainda estou processando outro comprovante.\nUse /cancelar para recomeçar.');
    }

    setState(userId, STATES.PROCESSING);

    // Pega a maior resolução disponível
    const photo = msg.photo[msg.photo.length - 1];
    const filePath = await downloadFile(bot, photo.file_id, '.jpg');
    await processVoucher(bot, chatId, userId, filePath);
  });

  // ─── Recebimento de documentos (PDF ou imagem como arquivo) ───────────────
  bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!isAllowed(userId)) return;

    const state = getState(userId);
    if (state !== STATES.IDLE) {
      return bot.sendMessage(chatId, '⚠️ Ainda estou processando outro comprovante.\nUse /cancelar para recomeçar.');
    }

    const doc = msg.document;
    const mime = doc.mime_type || '';
    let ext = '.jpg';
    if (mime === 'application/pdf') ext = '.pdf';
    else if (mime === 'image/png') ext = '.png';
    else if (mime === 'image/jpeg') ext = '.jpg';
    else if (mime === 'image/webp') ext = '.webp';
    else {
      return bot.sendMessage(chatId, '❌ Formato não suportado. Envie uma imagem (JPG, PNG) ou PDF.');
    }

    setState(userId, STATES.PROCESSING);
    const filePath = await downloadFile(bot, doc.file_id, ext);
    await processVoucher(bot, chatId, userId, filePath);
  });

  // ─── Texto livre (respostas do fluxo) ────────────────────────────────────
  bot.on('text', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!isAllowed(userId)) return;
    if (msg.text && msg.text.startsWith('/')) return; // ignora comandos

    const state = getState(userId);

    switch (state) {
      case STATES.AWAITING_EXTRATO_PERIOD: {
        // Valida formato MM/AAAA
        const periodMatch = msg.text.trim().match(/^(\d{2})\/(\d{4})$/);
        if (!periodMatch) {
          return bot.sendMessage(chatId, '⚠️ Formato inválido. Use MM/AAAA (ex: 04/2026).');
        }
        const [, month, year] = periodMatch;
        const monthNum = parseInt(month, 10);
        if (monthNum < 1 || monthNum > 12) {
          return bot.sendMessage(chatId, '⚠️ Mês inválido. Use um número entre 01 e 12.');
        }

        setData(userId, 'extratoMonth', month);
        setData(userId, 'extratoYear', year);

        // Lista funcionários cadastrados
        const employees = listEmployees();
        if (employees.length === 0) {
          resetConversation(userId);
          return bot.sendMessage(chatId, '⚠️ Nenhum funcionário cadastrado ainda. Emita pelo menos um recibo primeiro.');
        }

        // Salva lista no estado para uso no callback
        setData(userId, 'extratoEmployees', employees);
        setState(userId, STATES.AWAITING_EXTRATO_EMPLOYEE);

        // Monta teclado inline com os nomes (máx. 2 por linha)
        const keyboard = [];
        for (let i = 0; i < employees.length; i += 2) {
          const row = [{ text: employees[i].name, callback_data: `extrato_emp_${employees[i].id}` }];
          if (employees[i + 1]) {
            row.push({ text: employees[i + 1].name, callback_data: `extrato_emp_${employees[i + 1].id}` });
          }
          keyboard.push(row);
        }

        bot.sendMessage(
          chatId,
          `📅 Período: *${month}/${year}*\n\nSelecione o *funcionário*:`,
          { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } }
        );
        break;
      }

      case STATES.AWAITING_CARGO: {
        setData(userId, 'cargo', msg.text.trim());
        setState(userId, STATES.AWAITING_SETOR);
        bot.sendMessage(chatId, `✅ Cargo: *${msg.text.trim()}*\n\nQual é o *setor* deste funcionário?`, { parse_mode: 'Markdown' });
        break;
      }

      case STATES.AWAITING_SETOR: {
        setData(userId, 'setor', msg.text.trim());
        setState(userId, STATES.AWAITING_VALE_TYPE);
        bot.sendMessage(
          chatId,
          `✅ Setor: *${msg.text.trim()}*\n\nSelecione o *tipo de vale:*`,
          { parse_mode: 'Markdown', reply_markup: valeKeyboard() }
        );
        break;
      }

      case STATES.AWAITING_OUTRO_VALE: {
        setData(userId, 'valeType', msg.text.trim());
        await finishAndSendReceipt(bot, chatId, userId);
        break;
      }

      case STATES.AWAITING_EMPRESA_NAME: {
        setData(userId, 'empresaName', msg.text.trim());
        setState(userId, STATES.AWAITING_EMPRESA_CNPJ);
        bot.sendMessage(chatId, `✅ Nome: *${msg.text.trim()}*\n\nQual é o *CNPJ* da empresa? (ou envie "pular")`, { parse_mode: 'Markdown' });
        break;
      }

      case STATES.AWAITING_EMPRESA_CNPJ: {
        const cnpj = msg.text.trim() === 'pular' ? '' : msg.text.trim();
        setData(userId, 'empresaCnpj', cnpj);
        setState(userId, STATES.AWAITING_EMPRESA_ADDRESS);
        bot.sendMessage(chatId, `✅ CNPJ: *${cnpj || 'Não informado'}*\n\nQual é o *endereço* da empresa? (ou envie "pular")`, { parse_mode: 'Markdown' });
        break;
      }

      case STATES.AWAITING_EMPRESA_ADDRESS: {
        const address = msg.text.trim() === 'pular' ? '' : msg.text.trim();
        const d = getData(userId);
        saveCompany({
          name: d.empresaName,
          cnpj: d.empresaCnpj,
          address: address,
        });
        resetConversation(userId);
        bot.sendMessage(
          chatId,
          `✅ *Dados da empresa salvos!*\n\n` +
          `🏢 *${d.empresaName}*\n` +
          `CNPJ: ${d.empresaCnpj || 'Não informado'}\n` +
          `Endereço: ${address || 'Não informado'}\n\n` +
          `Agora envie um comprovante PIX para emitir o recibo.`,
          { parse_mode: 'Markdown' }
        );
        break;
      }

      default: {
        if (state === STATES.IDLE) {
          bot.sendMessage(
            chatId,
            '📎 Envie uma foto ou PDF do comprovante PIX para começar.\n\nUse /start para ver a lista de comandos.'
          );
        }
        break;
      }
    }
  });

  // ─── Callback dos botões inline (seleção de tipo de vale) ─────────────────
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    if (!isAllowed(userId)) return;

    await bot.answerCallbackQuery(query.id);

    if (query.data.startsWith('extrato_emp_')) {
      const state = getState(userId);
      if (state !== STATES.AWAITING_EXTRATO_EMPLOYEE) return;

      const empId = parseInt(query.data.replace('extrato_emp_', ''), 10);
      const d = getData(userId);
      const employees = d.extratoEmployees || [];
      const employee = employees.find(e => e.id === empId);

      if (!employee) {
        return bot.sendMessage(chatId, '❌ Funcionário não encontrado. Use /extrato para tentar novamente.');
      }

      // Remove o teclado inline
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: chatId,
        message_id: query.message.message_id,
      });

      await bot.sendMessage(
        chatId,
        `⏳ Gerando extrato de *${employee.name}* — *${d.extratoMonth}/${d.extratoYear}*...`,
        { parse_mode: 'Markdown' }
      );

      try {
        const receipts = getReceiptsByEmployeeAndPeriod(employee.name, d.extratoMonth, d.extratoYear);
        const company = getCompany() || {};

        const statementData = {
          companyName: company.name || 'EMPRESA',
          companyCnpj: company.cnpj || '',
          companyAddress: company.address || '',
          employeeName: employee.name,
          cargo: employee.cargo || '',
          setor: employee.setor || '',
          month: d.extratoMonth,
          year: d.extratoYear,
        };

        const pdfPath = await generateStatementPDF(statementData, receipts);
        const monthNames = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho',
          'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
        const monthLabel = monthNames[parseInt(d.extratoMonth, 10)];

        await bot.sendDocument(
          chatId,
          fs.createReadStream(pdfPath),
          {
            caption:
              `📊 *Extrato de ${employee.name}*\n` +
              `📅 Período: ${monthLabel}/${d.extratoYear}\n` +
              `🧾 ${receipts.length} recibo(s) encontrado(s)`,
            parse_mode: 'Markdown',
          },
          {
            filename: `extrato-${employee.name.replace(/\s+/g, '_')}-${d.extratoMonth}-${d.extratoYear}.pdf`,
            contentType: 'application/pdf',
          }
        );
        cleanupFile(pdfPath);
      } catch (err) {
        console.error('Erro ao gerar extrato:', err);
        bot.sendMessage(chatId, `❌ Erro ao gerar extrato: ${err.message}`);
      }

      resetConversation(userId);
      return;
    }

    if (query.data.startsWith('vale_')) {
      const state = getState(userId);
      if (state !== STATES.AWAITING_VALE_TYPE) return;

      const valeType = query.data.replace('vale_', '');

      if (valeType === 'outro') {
        setState(userId, STATES.AWAITING_OUTRO_VALE);
        bot.sendMessage(chatId, '📝 Digite o tipo de vale:');
        return;
      }

      setData(userId, 'valeType', valeType);
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: chatId,
        message_id: query.message.message_id,
      });
      await bot.sendMessage(chatId, `✅ Tipo selecionado: *Vale ${valeType}*`, { parse_mode: 'Markdown' });
      await finishAndSendReceipt(bot, chatId, userId);
    }
  });

  return bot;
}

module.exports = { startBot };
