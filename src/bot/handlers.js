const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const { extractFromVoucher } = require('../ai/extractor');
const { generatePDF, generateStatementPDF, cleanupFile } = require('../pdf/generator');
const { findEmployee, saveEmployee, listEmployees, deleteEmployee, getEmployeeById } = require('../database/employees');
const { getCompany, saveCompany } = require('../database/company');
const { saveReceipt, listReceipts, getReceiptByNumber, searchReceiptsByEmployee, getReceiptsByEmployeeAndPeriod, cancelReceiptByNumber, updateReceipt } = require('../database/receipts');
const { STATES, getState, setState, getData, setData, resetConversation } = require('./conversations');

const TEMP_DIR = path.join(__dirname, '../../temp');
const VALE_TYPES = ['Alimentação', 'Transporte', 'Refeição', 'Combustível', 'Adiantamento Salarial', 'Outro'];

/**
 * Retorna a data de hoje formatada como DD/MM/AAAA
 */
function todayBR() {
  return new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

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
      [
        { text: '🏖️ Férias', callback_data: 'vale_Férias' },
        { text: '🎁 13º Salário', callback_data: 'vale_13º Salário' },
      ],
      [{ text: '💰 Adiantamento Salarial', callback_data: 'vale_Adiantamento Salarial' }],
      [{ text: '📋 Outro (digitar)', callback_data: 'vale_outro' }],
    ],
  };
}

/**
 * Teclado inline para seleção de tipo de vale no fluxo dinheiro
 */
function valeKeyboardDinheiro() {
  return {
    inline_keyboard: [
      [
        { text: '🍽️ Alimentação', callback_data: 'dvale_Alimentação' },
        { text: '🚌 Transporte',  callback_data: 'dvale_Transporte' },
      ],
      [
        { text: '🍴 Refeição',    callback_data: 'dvale_Refeição' },
        { text: '⛽ Combustível',  callback_data: 'dvale_Combustível' },
      ],
      [
        { text: '🏖️ Férias', callback_data: 'dvale_Férias' },
        { text: '🎁 13º Salário', callback_data: 'dvale_13º Salário' },
      ],
      [{ text: '💰 Adiantamento Salarial', callback_data: 'dvale_Adiantamento Salarial' }],
      [{ text: '📋 Outro (digitar)', callback_data: 'dvale_outro' }],
    ],
  };
}

/**
 * Teclado inline para seleção de tipo de vale no fluxo de edição
 */
function valeKeyboardEdit() {
  return {
    inline_keyboard: [
      [
        { text: '🍽️ Alimentação', callback_data: 'evale_Alimentação' },
        { text: '🚌 Transporte',  callback_data: 'evale_Transporte' },
      ],
      [
        { text: '🍴 Refeição',    callback_data: 'evale_Refeição' },
        { text: '⛽ Combustível',  callback_data: 'evale_Combustível' },
      ],
      [
        { text: '🏖️ Férias',      callback_data: 'evale_Férias' },
        { text: '🎁 13º Salário', callback_data: 'evale_13º Salário' },
      ],
      [{ text: '💰 Adiantamento Salarial', callback_data: 'evale_Adiantamento Salarial' }],
      [{ text: '📋 Outro (digitar)', callback_data: 'evale_outro' }],
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
      // Funcionário novo — coleta CPF
      await bot.sendMessage(
        chatId,
        `👤 Funcionário *${escapeMd(extracted.nome_beneficiario)}* não encontrado.\n\n` +
        `Qual é o *CPF* deste funcionário? (Ou digite "pular")`,

        { parse_mode: 'Markdown' }
      );
      setState(userId, STATES.AWAITING_CPF);
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
      extraData: data.extraData || null,
    };

    // Salva no DB para obter o número sequencial
    // Salva/atualiza dados do funcionário antes de gerar o PDF para ter o CPF disponível
    if (!employee.id) {
      saveEmployee({
        name: extracted.nome_beneficiario,
        cpf: data.cpf !== 'pular' ? data.cpf : null,
        cargo: data.cargo,
        setor: data.setor,
      });
      const newEmp = findEmployee(extracted.nome_beneficiario);
      if (newEmp && newEmp.cpf) receiptData.employeeCpf = newEmp.cpf;
    } else {
      receiptData.employeeCpf = employee.cpf;
    }

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
      extraData: receiptData.extraData,
    });

    receiptData.receiptNumber = savedReceipt.receipt_number;

    // Gera o PDF
    const pdfPath = await generatePDF(receiptData, savedReceipt.receipt_number);

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
 * Gera e envia o PDF do recibo de pagamento em dinheiro
 */
async function finishAndSendCashReceipt(bot, chatId, userId) {
  const data = getData(userId);
  const employee = data.dinheiroEmployee || {};
  const company = getCompany() || {};

  setState(userId, STATES.PROCESSING);

  try {
    await bot.sendMessage(chatId, '⏳ Gerando o PDF do recibo...');

    const receiptData = {
      companyName:    company.name    || 'EMPRESA',
      companyCnpj:    company.cnpj    || '',
      companyAddress: company.address || '',
      employeeName:   data.dinheiroName,
      cargo:          employee.cargo  || data.dinheiroCargo || '',
      setor:          employee.setor  || data.dinheiroSetor || '',
      amount:         data.dinheiroValor,
      valeType:       data.dinheiroValeType,
      paymentDate:    data.dinheiroData,
      paymentMethod:  'dinheiro',
      extraData:      data.extraData || null,
    };

    const savedReceipt = saveReceipt({
      employee_name:    receiptData.employeeName,
      cargo:            receiptData.cargo,
      setor:            receiptData.setor,
      amount:           receiptData.amount,
      vale_type:        receiptData.valeType,
      payment_date:     receiptData.paymentDate,
      payment_method:   'dinheiro',
      company_name:     receiptData.companyName,
      company_cnpj:     receiptData.companyCnpj,
      telegram_user_id: String(userId),
      extraData:        receiptData.extraData,
    });

    // Salva funcionário se for novo antes de gerar o PDF para ter o CPF disponível
    if (!employee.id) {
      saveEmployee({
        name:  data.dinheiroName,
        cpf:   data.dinheiroCpf !== 'pular' ? data.dinheiroCpf : null,
        cargo: data.dinheiroCargo,
        setor: data.dinheiroSetor,
      });
      const newEmp = findEmployee(data.dinheiroName);
      if (newEmp && newEmp.cpf) receiptData.employeeCpf = newEmp.cpf;
    } else {
      receiptData.employeeCpf = employee.cpf;
    }

    receiptData.receiptNumber = savedReceipt.receipt_number;

    const pdfPath = await generatePDF(receiptData, savedReceipt.receipt_number);

    await bot.sendDocument(
      chatId,
      fs.createReadStream(pdfPath),
      {
        caption:
          `✅ *Recibo Nº ${savedReceipt.receipt_number}*\n` +
          `👤 ${receiptData.employeeName}\n` +
          `💵 ${receiptData.amount} — Vale ${receiptData.valeType}\n` +
          `💵 Pagamento em dinheiro\n` +
          `📅 ${receiptData.paymentDate}`,
        parse_mode: 'Markdown',
      },
      {
        filename: `recibo-${savedReceipt.receipt_number}.pdf`,
        contentType: 'application/pdf',
      }
    );

    cleanupFile(pdfPath);
    resetConversation(userId);
    await bot.sendMessage(
      chatId,
      '✅ Recibo em dinheiro emitido com sucesso!\n\nEnvie um comprovante PIX ou use /novo_recibo para emitir outro.'
    );
  } catch (err) {
    console.error('Erro ao gerar recibo dinheiro:', err);
    setState(userId, STATES.IDLE);
    bot.sendMessage(chatId, `❌ Erro ao gerar o recibo: ${err.message}`);
  }
}

/**
 * Atualiza os campos alterados no recibo e re-gera o PDF
 */
async function finishEditAndResendReceipt(bot, chatId, userId) {
  const d = getData(userId);
  const receiptNumber = d.editReceiptNumber;

  setState(userId, STATES.PROCESSING);

  try {
    await bot.sendMessage(chatId, '⏳ Atualizando e gerando o PDF do recibo...');

    const updates = {};
    if (d.editAmount !== undefined)    updates.amount      = d.editAmount;
    if (d.editValeType !== undefined)  updates.vale_type   = d.editValeType;
    if (d.editDate !== undefined)      updates.payment_date = d.editDate;
    if (d.editCargo !== undefined)     updates.cargo       = d.editCargo;
    if (d.editSetor !== undefined)     updates.setor       = d.editSetor;

    if (d.editValeType !== undefined) {
      if (d.editExtraData !== undefined) {
        updates.extra_data = JSON.stringify(d.editExtraData);
      } else if (d.editValeType !== 'Férias' && d.editValeType !== '13º Salário') {
        updates.extra_data = null;
      }
    } else if (d.editExtraData !== undefined) {
      updates.extra_data = JSON.stringify(d.editExtraData);
    }

    const updatedReceipt = Object.keys(updates).length > 0
      ? updateReceipt(receiptNumber, updates)
      : getReceiptByNumber(receiptNumber);

    const company = getCompany() || {};
    const emp = findEmployee(updatedReceipt.employee_name);

    const receiptData = {
      receiptNumber:  updatedReceipt.receipt_number,
      companyName:    updatedReceipt.company_name || company.name    || 'EMPRESA',
      companyCnpj:    updatedReceipt.company_cnpj || company.cnpj    || '',
      companyAddress: company.address || '',
      employeeName:   updatedReceipt.employee_name,
      employeeCpf:    emp ? emp.cpf : null,
      cargo:          updatedReceipt.cargo,
      setor:          updatedReceipt.setor,
      amount:         updatedReceipt.amount,
      valeType:       updatedReceipt.vale_type,
      paymentDate:    updatedReceipt.payment_date,
      paymentTime:    updatedReceipt.payment_time,
      pixKey:         updatedReceipt.pix_key,
      agenciaConta:   updatedReceipt.agencia_conta,
      transactionId:  updatedReceipt.transaction_id,
      bankName:       updatedReceipt.bank_name,
      paymentMethod:  updatedReceipt.payment_method || 'pix',
    };

    if (updatedReceipt.extra_data) {
      try { receiptData.extraData = JSON.parse(updatedReceipt.extra_data); } catch (e) {}
    }

    const pdfPath = await generatePDF(receiptData, updatedReceipt.receipt_number);

    await bot.sendDocument(
      chatId,
      fs.createReadStream(pdfPath),
      {
        caption:
          `✅ *Recibo Nº ${updatedReceipt.receipt_number} (Re-emitido)*\n` +
          `👤 ${updatedReceipt.employee_name}\n` +
          `💰 ${updatedReceipt.amount} — Vale ${updatedReceipt.vale_type}\n` +
          `📅 ${updatedReceipt.payment_date}`,
        parse_mode: 'Markdown',
      },
      {
        filename: `recibo-${updatedReceipt.receipt_number}.pdf`,
        contentType: 'application/pdf',
      }
    );

    cleanupFile(pdfPath);
    resetConversation(userId);
    await bot.sendMessage(chatId, '✅ Recibo atualizado e re-emitido com sucesso!');
  } catch (err) {
    console.error('Erro ao editar recibo:', err);
    setState(userId, STATES.IDLE);
    bot.sendMessage(chatId, `❌ Erro ao editar o recibo: ${err.message}`);
  }
}

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
      `2. Envie a foto ou PDF do comprovante PIX — *ou* use /novo_recibo para pagamento em dinheiro\n` +
      `3. Responda as perguntas do bot\n` +
      `4. Receba o PDF do recibo pronto para imprimir!\n\n` +
      `📌 *Comandos disponíveis:*\n` +
      `/empresa — Configurar dados da empresa\n` +
      `/novo_recibo — Emitir recibo de pagamento em dinheiro\n` +
      `/colaboradores — Gerenciar dados dos colaboradores\n` +
      `/historico [Qtd] — Ver últimos recibos (ex: /historico 20)\n` +
      `/buscar Nome — Buscar recibos de um funcionário\n` +
      `/extrato — Gerar extrato mensal de um funcionário\n` +
      `/editar_recibo NUMERO — Editar e re-emitir um recibo (ex: /editar_recibo 202604-001)\n` +
      `/cancelar_recibo NUMERO — Cancelar um recibo emitido (ex: /cancelar_recibo 202604-001)\n` +
      `/cancelar — Cancelar operação atual`,
      { parse_mode: 'Markdown' }
    );
  });

  // ─── /novo_recibo ───────────────────────────────────────────────────────
  bot.onText(/\/novo_recibo/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!isAllowed(userId)) return;

    const state = getState(userId);
    if (state !== STATES.IDLE) {
      return bot.sendMessage(chatId,
        '⚠️ Há uma operação em andamento.\nUse /cancelar para recomecar.');
    }

    const company = getCompany();
    if (!company || !company.name) {
      return bot.sendMessage(chatId,
        '⚠️ Você ainda não configurou os dados da empresa.\n' +
        'Use /empresa primeiro.');
    }

    resetConversation(userId);

    const employees = listEmployees();

    if (employees.length === 0) {
      setState(userId, STATES.AWAITING_DINHEIRO_NAME);
      return bot.sendMessage(
        chatId,
        '💵 *Recibo de Pagamento em Dinheiro*\n\n' +
        'Nenhum colaborador cadastrado ainda.\n\nDigite o *nome completo* do funcionário:',
        { parse_mode: 'Markdown' }
      );
    }

    setState(userId, STATES.AWAITING_DINHEIRO_SELECT);

    const keyboard = [];
    for (let i = 0; i < employees.length; i += 2) {
      const row = [{ text: employees[i].name, callback_data: `dinheiro_emp_${employees[i].id}` }];
      if (employees[i + 1]) {
        row.push({ text: employees[i + 1].name, callback_data: `dinheiro_emp_${employees[i + 1].id}` });
      }
      keyboard.push(row);
    }
    keyboard.push([{ text: '➕ Novo Colaborador', callback_data: 'dinheiro_new' }]);

    bot.sendMessage(
      chatId,
      '💵 *Recibo de Pagamento em Dinheiro*\n\nSelecione o *colaborador*:',
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } }
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
  bot.onText(/\/cancelar$/, (msg) => {
    const chatId = msg.chat.id;
    if (!isAllowed(msg.from.id)) return;
    resetConversation(msg.from.id);
    bot.sendMessage(chatId, '❌ Operação cancelada. Envie um comprovante PIX ou use /novo_recibo.');
  });

  // ─── /cancelar_recibo ──────────────────────────────────────────────────────
  bot.onText(/\/cancelar_recibo (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (!isAllowed(msg.from.id)) return;

    const receiptNumber = match[1].trim();
    const receipt = getReceiptByNumber(receiptNumber);

    if (!receipt) {
      return bot.sendMessage(chatId, `❌ Recibo *${receiptNumber}* não encontrado.`, { parse_mode: 'Markdown' });
    }

    if (receipt.status === 'cancelled') {
      return bot.sendMessage(chatId, `⚠️ O recibo *${receiptNumber}* já está cancelado.`, { parse_mode: 'Markdown' });
    }

    cancelReceiptByNumber(receiptNumber);
    bot.sendMessage(
      chatId,
      `🚫 *Recibo Cancelado com Sucesso!*\n\n` +
      `Recibo: *${receiptNumber}*\n` +
      `Funcionário: ${receipt.employee_name}\n` +
      `Valor: ${receipt.amount}\n\n` +
      `O recibo não foi apagado do banco de dados, mas agora consta como cancelado no histórico e extrato.`,
      { parse_mode: 'Markdown' }
    );
  });

  // ─── /editar_recibo ───────────────────────────────────────────────────────
  bot.onText(/\/editar_recibo (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!isAllowed(userId)) return;

    const state = getState(userId);
    if (state !== STATES.IDLE) {
      return bot.sendMessage(chatId, '⚠️ Há uma operação em andamento. Use /cancelar para recomeçar.');
    }

    const receiptNumber = match[1].trim();
    const receipt = getReceiptByNumber(receiptNumber);

    if (!receipt) {
      return bot.sendMessage(chatId, `❌ Recibo *${receiptNumber}* não encontrado.`, { parse_mode: 'Markdown' });
    }

    if (receipt.status === 'cancelled') {
      return bot.sendMessage(
        chatId,
        `⚠️ O recibo *${receiptNumber}* está cancelado e não pode ser editado.`,
        { parse_mode: 'Markdown' }
      );
    }

    resetConversation(userId);
    setData(userId, 'editReceiptNumber', receiptNumber);
    setState(userId, STATES.AWAITING_EDIT_FIELD);

    const methodLabel = receipt.payment_method === 'dinheiro' ? '💵 Dinheiro' : '📲 PIX';

    bot.sendMessage(
      chatId,
      `✏️ *Editar Recibo ${receiptNumber}*\n\n` +
      `👤 *${escapeMd(receipt.employee_name)}*\n` +
      `💰 ${escapeMd(receipt.amount)} — Vale ${escapeMd(receipt.vale_type)}\n` +
      `📅 ${receipt.payment_date}${receipt.payment_time ? ' às ' + receipt.payment_time : ''}\n` +
      `${methodLabel}\n\n` +
      `Qual campo deseja alterar?`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💰 Valor',         callback_data: 'edit_field_amount' },
              { text: '🏷️ Tipo de Vale',  callback_data: 'edit_field_vale' },
            ],
            [{ text: '📅 Data de Pagamento', callback_data: 'edit_field_date' }],
            [
              { text: '💼 Cargo',  callback_data: 'edit_field_cargo' },
              { text: '🏢 Setor',  callback_data: 'edit_field_setor' },
            ],
            [{ text: '🔄 Re-emitir (sem alterações)', callback_data: 'edit_field_reissue' }],
          ],
        },
      }
    );
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
      const isCancelled = r.status === 'cancelled';
      const statusLabel = isCancelled ? ' 🚫 *(CANCELADO)*' : '';
      const amountLabel = isCancelled ? `~${r.amount}~` : r.amount;
      text += `${i + 1}. *${r.receipt_number}* — ${r.employee_name}${statusLabel}\n`;
      text += `   💰 ${amountLabel} | 🏷️ Vale ${r.vale_type} | 📅 ${r.payment_date}\n\n`;
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
      const isCancelled = r.status === 'cancelled';
      const statusLabel = isCancelled ? ' 🚫 *(CANCELADO)*' : '';
      const amountLabel = isCancelled ? `~${r.amount}~` : r.amount;
      text += `*${r.receipt_number}* — ${r.employee_name}${statusLabel}\n`;
      text += `💰 ${amountLabel} | 📅 ${r.payment_date}\n\n`;
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
      const empForReceipt = findEmployee(receipt.employee_name);
      const receiptData = {
        receiptNumber: receipt.receipt_number,
        companyName: receipt.company_name || company.name || 'EMPRESA',
        companyCnpj: receipt.company_cnpj || company.cnpj || '',
        companyAddress: company.address || '',
        employeeName: receipt.employee_name,
        employeeCpf: empForReceipt ? empForReceipt.cpf : null,
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
        paymentMethod: receipt.payment_method || 'pix',
      };

      const pdfPath = await generatePDF(receiptData, receipt.receipt_number);
      const isCancelled = receipt.status === 'cancelled';
      const statusLabel = isCancelled ? ' 🚫 *(CANCELADO)*' : '';
      await bot.sendDocument(
        chatId,
        fs.createReadStream(pdfPath),
        {
          caption: `✅ Recibo *${receiptNumber}* — ${receipt.employee_name}${statusLabel}`,
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

  // ─── /colaboradores ───────────────────────────────────────────────────────
  bot.onText(/\/colaboradores/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!isAllowed(userId)) return;

    resetConversation(userId);
    bot.sendMessage(
      chatId,
      `👥 *Gerenciamento de Colaboradores*\n\nEscolha uma opção abaixo:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Adicionar Colaborador', callback_data: 'colab_add' }],
            [{ text: '✏️ Editar Colaborador', callback_data: 'colab_edit' }],
            [{ text: '❌ Remover Colaborador', callback_data: 'colab_del' }],
            [{ text: '📋 Listar Colaboradores', callback_data: 'colab_list' }]
          ]
        }
      }
    );
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

      // ─── Fluxo de Gerenciamento de Colaboradores ───
      case STATES.AWAITING_COLAB_NOME: {
        const input = msg.text.trim();
        const editId = getData(userId).editColabId;
        const employee = editId ? getEmployeeById(editId) : null;
        
        let nomeFinal = input;
        if (editId && input.toLowerCase() === 'manter') {
          nomeFinal = employee.name;
        }

        setData(userId, 'colabName', nomeFinal);
        setState(userId, STATES.AWAITING_COLAB_CPF);
        
        const cpfText = editId ? `(atual: ${employee.cpf || 'vazio'}, ou "manter")` : `(ou "pular")`;
        bot.sendMessage(chatId, `✅ Nome: *${escapeMd(nomeFinal)}*\n\nDigite o *CPF* ${cpfText}:`, { parse_mode: 'Markdown' });
        break;
      }

      case STATES.AWAITING_COLAB_CPF: {
        const input = msg.text.trim();
        const editId = getData(userId).editColabId;
        const employee = editId ? getEmployeeById(editId) : null;
        
        let cpfFinal = input === 'pular' ? '' : input;
        if (editId && input.toLowerCase() === 'manter') {
          cpfFinal = employee.cpf || '';
        }

        setData(userId, 'colabCpf', cpfFinal);
        setState(userId, STATES.AWAITING_COLAB_CARGO);
        
        const cargoText = editId ? `(atual: ${employee.cargo || 'vazio'}, ou "manter")` : ``;
        bot.sendMessage(chatId, `✅ CPF: *${cpfFinal || 'Não informado'}*\n\nDigite o *Cargo* ${cargoText}:`, { parse_mode: 'Markdown' });
        break;
      }

      case STATES.AWAITING_COLAB_CARGO: {
        const input = msg.text.trim();
        const editId = getData(userId).editColabId;
        const employee = editId ? getEmployeeById(editId) : null;
        
        let cargoFinal = input;
        if (editId && input.toLowerCase() === 'manter') {
          cargoFinal = employee.cargo || '';
        }

        setData(userId, 'colabCargo', cargoFinal);
        setState(userId, STATES.AWAITING_COLAB_SETOR);
        
        const setorText = editId ? `(atual: ${employee.setor || 'vazio'}, ou "manter")` : ``;
        bot.sendMessage(chatId, `✅ Cargo: *${escapeMd(cargoFinal)}*\n\nDigite o *Setor* ${setorText}:`, { parse_mode: 'Markdown' });
        break;
      }

      case STATES.AWAITING_COLAB_SETOR: {
        const input = msg.text.trim();
        const d = getData(userId);
        const editId = d.editColabId;
        const employee = editId ? getEmployeeById(editId) : null;
        
        let setorFinal = input;
        if (editId && input.toLowerCase() === 'manter') {
          setorFinal = employee.setor || '';
        }

        saveEmployee({
          id: editId || undefined,
          name: d.colabName,
          cpf: d.colabCpf || null,
          cargo: d.colabCargo,
          setor: setorFinal
        });

        resetConversation(userId);
        bot.sendMessage(
          chatId,
          `✅ Colaborador *${editId ? 'atualizado' : 'cadastrado'}* com sucesso!\n\n` +
          `👤 *${escapeMd(d.colabName)}*\nCPF: ${d.colabCpf || 'Não informado'}\nCargo: ${escapeMd(d.colabCargo)}\nSetor: ${escapeMd(setorFinal)}`,
          { parse_mode: 'Markdown' }
        );
        break;
      }

      case STATES.AWAITING_CPF: {
        const cpf = msg.text.trim() === 'pular' ? '' : msg.text.trim();
        setData(userId, 'cpf', cpf);
        setState(userId, STATES.AWAITING_CARGO);
        bot.sendMessage(chatId, `✅ CPF: *${cpf || 'Não informado'}*\n\nQual é o *cargo* deste funcionário?`, { parse_mode: 'Markdown' });
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

      // ─── Fluxo de pagamento em dinheiro ───────────────────────────────────

      case STATES.AWAITING_DINHEIRO_NAME: {
        const name = msg.text.trim();
        if (name.length < 2) {
          return bot.sendMessage(chatId, '⚠️ Digite um nome válido com pelo menos 2 caracteres.');
        }
        setData(userId, 'dinheiroName', name);

        // Verifica se já existe no banco (evita duplicatas)
        const emp = findEmployee(name);
        if (emp) {
          setData(userId, 'dinheiroEmployee', emp);
          setState(userId, STATES.AWAITING_DINHEIRO_VALOR);
          bot.sendMessage(
            chatId,
            `ℹ️ *${escapeMd(name)}* já está cadastrado.\n` +
            `Cargo: *${escapeMd(emp.cargo)}* | Setor: *${escapeMd(emp.setor)}*\n\n` +
            `Digite o *valor* pago em dinheiro (ex: R$ 150,00):`,
            { parse_mode: 'Markdown' }
          );
        } else {
          setData(userId, 'dinheiroEmployee', {});
          setState(userId, STATES.AWAITING_DINHEIRO_CPF);
          bot.sendMessage(
            chatId,
            `👤 Cadastrando *${escapeMd(name)}*.\n\nQual é o *CPF*? (Ou digite "pular")`,
            { parse_mode: 'Markdown' }
          );
        }
        break;
      }

      case STATES.AWAITING_DINHEIRO_CPF: {
        const cpf = msg.text.trim() === 'pular' ? '' : msg.text.trim();
        setData(userId, 'dinheiroCpf', cpf);
        setState(userId, STATES.AWAITING_DINHEIRO_CARGO);
        bot.sendMessage(chatId, `✅ CPF: *${cpf || 'Não informado'}*\n\nQual é o *cargo* deste funcionário?`, { parse_mode: 'Markdown' });
        break;
      }

      case STATES.AWAITING_DINHEIRO_CARGO: {
        setData(userId, 'dinheiroCargo', msg.text.trim());
        setState(userId, STATES.AWAITING_DINHEIRO_SETOR);
        bot.sendMessage(chatId,
          `✅ Cargo: *${escapeMd(msg.text.trim())}*\n\nQual é o *setor* deste funcionário?`,
          { parse_mode: 'Markdown' });
        break;
      }

      case STATES.AWAITING_DINHEIRO_SETOR: {
        setData(userId, 'dinheiroSetor', msg.text.trim());
        setState(userId, STATES.AWAITING_DINHEIRO_VALOR);
        bot.sendMessage(chatId,
          `✅ Setor: *${escapeMd(msg.text.trim())}*\n\nDigite o *valor* pago em dinheiro (ex: R$ 150,00):`,
          { parse_mode: 'Markdown' });
        break;
      }

      case STATES.AWAITING_DINHEIRO_VALOR: {
        const raw = msg.text.trim();
        // Aceita formatos: 150, 150.00, 150,00, R$ 150,00
        const cleaned = raw.replace('R$', '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
        const parsed = parseFloat(cleaned);
        if (isNaN(parsed) || parsed <= 0) {
          return bot.sendMessage(chatId, '⚠️ Valor inválido. Tente novamente (ex: R$ 150,00).');
        }
        const valor = `R$ ${parsed.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        setData(userId, 'dinheiroValor', valor);
        setState(userId, STATES.AWAITING_DINHEIRO_DATA);

        const hoje = todayBR();
        bot.sendMessage(
          chatId,
          `✅ Valor: *${escapeMd(valor)}*\n\n` +
          `📅 Qual é a *data* do pagamento?\n` +
          `Envie no formato DD/MM/AAAA ou escreva *hoje* para usar ${escapeMd(hoje)}:`,
          { parse_mode: 'Markdown' }
        );
        break;
      }

      case STATES.AWAITING_DINHEIRO_DATA: {
        const dateRaw = msg.text.trim().toLowerCase();
        let dateValue;
        if (dateRaw === 'hoje') {
          dateValue = todayBR();
        } else {
          if (!/^\d{2}\/\d{2}\/\d{4}$/.test(msg.text.trim())) {
            return bot.sendMessage(chatId,
              '⚠️ Formato inválido. Use DD/MM/AAAA ou escreva *hoje*.',
              { parse_mode: 'Markdown' });
          }
          dateValue = msg.text.trim();
        }
        setData(userId, 'dinheiroData', dateValue);
        setState(userId, STATES.AWAITING_DINHEIRO_VALE);
        bot.sendMessage(
          chatId,
          `✅ Data: *${escapeMd(dateValue)}*\n\nSelecione o *tipo de vale:*`,
          { parse_mode: 'Markdown', reply_markup: valeKeyboardDinheiro() }
        );
        break;
      }

      case STATES.AWAITING_DINHEIRO_OUTRO_VALE: {
        setData(userId, 'dinheiroValeType', msg.text.trim());
        await finishAndSendCashReceipt(bot, chatId, userId);
        break;
      }

      case STATES.AWAITING_FERIAS_AQUISITIVO: {
        setData(userId, 'extraData', { periodoAquisitivo: msg.text.trim() });
        setState(userId, STATES.AWAITING_FERIAS_GOZO);
        bot.sendMessage(chatId, `✅ Período Aquisitivo: *${escapeMd(msg.text.trim())}*\n\nQual é o *Período de Gozo* (ex: 01/05/2026 a 30/05/2026)?`, { parse_mode: 'Markdown' });
        break;
      }

      case STATES.AWAITING_FERIAS_GOZO: {
        const d = getData(userId);
        d.extraData = d.extraData || {};
        d.extraData.periodoGozo = msg.text.trim();
        const isDinheiro = !!d.dinheiroName;
        if (isDinheiro) await finishAndSendCashReceipt(bot, chatId, userId);
        else await finishAndSendReceipt(bot, chatId, userId);
        break;
      }

      case STATES.AWAITING_DECIMO_PARCELA: {
        setData(userId, 'extraData', { parcelaDecimo: msg.text.trim() });
        setState(userId, STATES.AWAITING_DECIMO_ANO);
        bot.sendMessage(chatId, `✅ Parcela: *${escapeMd(msg.text.trim())}*\n\nQual é o *Ano de Referência* (ex: 2026)?`, { parse_mode: 'Markdown' });
        break;
      }

      case STATES.AWAITING_DECIMO_ANO: {
        const d = getData(userId);
        d.extraData = d.extraData || {};
        d.extraData.anoBase = msg.text.trim();
        const isDinheiro = !!d.dinheiroName;
        if (isDinheiro) await finishAndSendCashReceipt(bot, chatId, userId);
        else await finishAndSendReceipt(bot, chatId, userId);
        break;
      }

      // ─── Fluxo de edição de recibos ────────────────────────────────────────

      case STATES.AWAITING_EDIT_AMOUNT: {
        const raw = msg.text.trim();
        const cleaned = raw.replace('R$', '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
        const parsed = parseFloat(cleaned);
        if (isNaN(parsed) || parsed <= 0) {
          return bot.sendMessage(chatId, '⚠️ Valor inválido. Tente novamente (ex: R$ 150,00).');
        }
        const valor = `R$ ${parsed.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        setData(userId, 'editAmount', valor);
        await finishEditAndResendReceipt(bot, chatId, userId);
        break;
      }

      case STATES.AWAITING_EDIT_DATE: {
        const dateRaw = msg.text.trim().toLowerCase();
        let dateValue;
        if (dateRaw === 'hoje') {
          dateValue = todayBR();
        } else {
          if (!/^\d{2}\/\d{2}\/\d{4}$/.test(msg.text.trim())) {
            return bot.sendMessage(chatId, '⚠️ Formato inválido. Use DD/MM/AAAA ou escreva *hoje*.', { parse_mode: 'Markdown' });
          }
          dateValue = msg.text.trim();
        }
        setData(userId, 'editDate', dateValue);
        await finishEditAndResendReceipt(bot, chatId, userId);
        break;
      }

      case STATES.AWAITING_EDIT_CARGO: {
        setData(userId, 'editCargo', msg.text.trim());
        await finishEditAndResendReceipt(bot, chatId, userId);
        break;
      }

      case STATES.AWAITING_EDIT_SETOR: {
        setData(userId, 'editSetor', msg.text.trim());
        await finishEditAndResendReceipt(bot, chatId, userId);
        break;
      }

      case STATES.AWAITING_EDIT_OUTRO_VALE: {
        setData(userId, 'editValeType', msg.text.trim());
        await finishEditAndResendReceipt(bot, chatId, userId);
        break;
      }

      case STATES.AWAITING_EDIT_FERIAS_AQUISITIVO: {
        setData(userId, 'editExtraData', { periodoAquisitivo: msg.text.trim() });
        setState(userId, STATES.AWAITING_EDIT_FERIAS_GOZO);
        bot.sendMessage(
          chatId,
          `✅ Período Aquisitivo: *${escapeMd(msg.text.trim())}*\n\nQual é o *Período de Gozo* (ex: 01/05/2026 a 30/05/2026)?`,
          { parse_mode: 'Markdown' }
        );
        break;
      }

      case STATES.AWAITING_EDIT_FERIAS_GOZO: {
        const d = getData(userId);
        d.editExtraData = d.editExtraData || {};
        d.editExtraData.periodoGozo = msg.text.trim();
        await finishEditAndResendReceipt(bot, chatId, userId);
        break;
      }

      case STATES.AWAITING_EDIT_DECIMO_PARCELA: {
        setData(userId, 'editExtraData', { parcelaDecimo: msg.text.trim() });
        setState(userId, STATES.AWAITING_EDIT_DECIMO_ANO);
        bot.sendMessage(
          chatId,
          `✅ Parcela: *${escapeMd(msg.text.trim())}*\n\nQual é o *Ano de Referência* (ex: 2026)?`,
          { parse_mode: 'Markdown' }
        );
        break;
      }

      case STATES.AWAITING_EDIT_DECIMO_ANO: {
        const dEdit = getData(userId);
        dEdit.editExtraData = dEdit.editExtraData || {};
        dEdit.editExtraData.anoBase = msg.text.trim();
        await finishEditAndResendReceipt(bot, chatId, userId);
        break;
      }

      default: {
        if (state === STATES.IDLE) {
          bot.sendMessage(
            chatId,
            '📎 Envie uma foto ou PDF do comprovante PIX para começar.\n\nOu use /novo_recibo para emitir um recibo de pagamento em dinheiro.\n\nUse /start para ver a lista de comandos.'
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

    if (query.data.startsWith('colab_')) {
      const action = query.data;
      
      // Remove o menu inicial
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: chatId,
        message_id: query.message.message_id,
      });

      if (action === 'colab_add') {
        setState(userId, STATES.AWAITING_COLAB_NOME);
        return bot.sendMessage(chatId, '📝 Digite o *nome completo* do novo colaborador:', { parse_mode: 'Markdown' });
      }

      if (action === 'colab_list') {
        const employees = listEmployees();
        if (employees.length === 0) return bot.sendMessage(chatId, 'Nenhum funcionário cadastrado.');
        let text = '📋 *Lista de Colaboradores:*\n\n';
        employees.forEach(e => {
          text += `👤 *${e.name}*\nCPF: ${e.cpf || 'Não informado'} | Cargo: ${e.cargo}\n\n`;
        });
        resetConversation(userId);
        return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      }

      if (action === 'colab_edit' || action === 'colab_del') {
        const employees = listEmployees();
        if (employees.length === 0) return bot.sendMessage(chatId, 'Nenhum funcionário cadastrado.');

        const isEdit = action === 'colab_edit';
        setState(userId, isEdit ? STATES.AWAITING_COLAB_EDIT_SELECTION : STATES.AWAITING_COLAB_DELETE_SELECTION);
        setData(userId, 'colabList', employees);

        const keyboard = [];
        for (let i = 0; i < employees.length; i += 2) {
          const row = [{ text: employees[i].name, callback_data: `sel_colab_${employees[i].id}` }];
          if (employees[i + 1]) {
            row.push({ text: employees[i + 1].name, callback_data: `sel_colab_${employees[i + 1].id}` });
          }
          keyboard.push(row);
        }

        return bot.sendMessage(chatId, `Selecione o colaborador para *${isEdit ? 'editar' : 'remover'}*:`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard }
        });
      }
    }

    if (query.data.startsWith('sel_colab_')) {
      const state = getState(userId);
      if (state !== STATES.AWAITING_COLAB_EDIT_SELECTION && state !== STATES.AWAITING_COLAB_DELETE_SELECTION) return;

      const empId = parseInt(query.data.replace('sel_colab_', ''), 10);
      const employee = getEmployeeById(empId);

      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: chatId,
        message_id: query.message.message_id,
      });

      if (!employee) return bot.sendMessage(chatId, '❌ Colaborador não encontrado.');

      if (state === STATES.AWAITING_COLAB_DELETE_SELECTION) {
        deleteEmployee(empId);
        resetConversation(userId);
        return bot.sendMessage(chatId, `✅ Colaborador *${escapeMd(employee.name)}* removido com sucesso.`, { parse_mode: 'Markdown' });
      } else {
        // Edit flow
        setData(userId, 'editColabId', empId);
        setState(userId, STATES.AWAITING_COLAB_NOME);
        return bot.sendMessage(chatId, `✏️ Editando: *${escapeMd(employee.name)}*\n\nDigite o novo *Nome* (ou envie "manter"):`, { parse_mode: 'Markdown' });
      }
    }

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

    if (query.data.startsWith('dinheiro_emp_') || query.data === 'dinheiro_new') {
      const state = getState(userId);
      if (state !== STATES.AWAITING_DINHEIRO_SELECT) return;

      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: chatId,
        message_id: query.message.message_id,
      });

      if (query.data === 'dinheiro_new') {
        setState(userId, STATES.AWAITING_DINHEIRO_NAME);
        return bot.sendMessage(chatId, '👤 Digite o *nome completo* do novo colaborador:', { parse_mode: 'Markdown' });
      }

      const empId = parseInt(query.data.replace('dinheiro_emp_', ''), 10);
      const employee = getEmployeeById(empId);

      if (!employee) {
        resetConversation(userId);
        return bot.sendMessage(chatId, '❌ Colaborador não encontrado. Use /novo_recibo para tentar novamente.');
      }

      setData(userId, 'dinheiroName', employee.name);
      setData(userId, 'dinheiroEmployee', employee);
      setState(userId, STATES.AWAITING_DINHEIRO_VALOR);
      return bot.sendMessage(
        chatId,
        `✅ *${escapeMd(employee.name)}* selecionado\n` +
        `Cargo: *${escapeMd(employee.cargo)}* | Setor: *${escapeMd(employee.setor)}*\n\n` +
        `Digite o *valor* pago em dinheiro (ex: R$ 150,00):`,
        { parse_mode: 'Markdown' }
      );
    }

    if (query.data.startsWith('dvale_')) {
      const state = getState(userId);
      if (state !== STATES.AWAITING_DINHEIRO_VALE) return;

      const valeType = query.data.replace('dvale_', '');

      if (valeType === 'outro') {
        setState(userId, STATES.AWAITING_DINHEIRO_OUTRO_VALE);
        bot.sendMessage(chatId, '📝 Digite o tipo de vale:');
        return;
      }

      setData(userId, 'dinheiroValeType', valeType);
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: chatId,
        message_id: query.message.message_id,
      });

      if (valeType === 'Férias') {
        setState(userId, STATES.AWAITING_FERIAS_AQUISITIVO);
        await bot.sendMessage(chatId, `✅ Tipo selecionado: *Férias*\n\nQual é o *Período Aquisitivo* (ex: 2024/2025)?`, { parse_mode: 'Markdown' });
        return;
      }
      if (valeType === '13º Salário') {
        setState(userId, STATES.AWAITING_DECIMO_PARCELA);
        await bot.sendMessage(chatId, `✅ Tipo selecionado: *13º Salário*\n\nQual é a *Parcela* (ex: 1ª Parcela, Parcela Única)?`, { parse_mode: 'Markdown' });
        return;
      }

      await bot.sendMessage(chatId, `✅ Tipo selecionado: *Vale ${escapeMd(valeType)}*`, { parse_mode: 'Markdown' });
      await finishAndSendCashReceipt(bot, chatId, userId);
      return;
    }

    if (query.data.startsWith('edit_field_')) {
      const state = getState(userId);
      if (state !== STATES.AWAITING_EDIT_FIELD) return;

      const field = query.data.replace('edit_field_', '');

      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: chatId,
        message_id: query.message.message_id,
      });

      if (field === 'reissue') {
        await finishEditAndResendReceipt(bot, chatId, userId);
        return;
      }

      if (field === 'amount') {
        setState(userId, STATES.AWAITING_EDIT_AMOUNT);
        return bot.sendMessage(chatId, '💰 Digite o *novo valor* (ex: R$ 1.500,00):', { parse_mode: 'Markdown' });
      }

      if (field === 'vale') {
        setState(userId, STATES.AWAITING_EDIT_VALE_TYPE);
        return bot.sendMessage(chatId, '🏷️ Selecione o *novo tipo de vale:*', {
          parse_mode: 'Markdown',
          reply_markup: valeKeyboardEdit(),
        });
      }

      if (field === 'date') {
        setState(userId, STATES.AWAITING_EDIT_DATE);
        const hoje = todayBR();
        return bot.sendMessage(
          chatId,
          `📅 Digite a *nova data* de pagamento (DD/MM/AAAA) ou *hoje* para usar ${escapeMd(hoje)}:`,
          { parse_mode: 'Markdown' }
        );
      }

      if (field === 'cargo') {
        setState(userId, STATES.AWAITING_EDIT_CARGO);
        return bot.sendMessage(chatId, '💼 Digite o *novo cargo:*', { parse_mode: 'Markdown' });
      }

      if (field === 'setor') {
        setState(userId, STATES.AWAITING_EDIT_SETOR);
        return bot.sendMessage(chatId, '🏢 Digite o *novo setor:*', { parse_mode: 'Markdown' });
      }
    }

    if (query.data.startsWith('evale_')) {
      const state = getState(userId);
      if (state !== STATES.AWAITING_EDIT_VALE_TYPE) return;

      const valeType = query.data.replace('evale_', '');

      if (valeType === 'outro') {
        setState(userId, STATES.AWAITING_EDIT_OUTRO_VALE);
        return bot.sendMessage(chatId, '📝 Digite o tipo de vale:');
      }

      setData(userId, 'editValeType', valeType);
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: chatId,
        message_id: query.message.message_id,
      });

      if (valeType === 'Férias') {
        setState(userId, STATES.AWAITING_EDIT_FERIAS_AQUISITIVO);
        return bot.sendMessage(
          chatId,
          `✅ Tipo: *Férias*\n\nQual é o *Período Aquisitivo* (ex: 2024/2025)?`,
          { parse_mode: 'Markdown' }
        );
      }

      if (valeType === '13º Salário') {
        setState(userId, STATES.AWAITING_EDIT_DECIMO_PARCELA);
        return bot.sendMessage(
          chatId,
          `✅ Tipo: *13º Salário*\n\nQual é a *Parcela* (ex: 1ª Parcela, Parcela Única)?`,
          { parse_mode: 'Markdown' }
        );
      }

      await bot.sendMessage(chatId, `✅ Novo tipo: *Vale ${escapeMd(valeType)}*`, { parse_mode: 'Markdown' });
      await finishEditAndResendReceipt(bot, chatId, userId);
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

      if (valeType === 'Férias') {
        setState(userId, STATES.AWAITING_FERIAS_AQUISITIVO);
        await bot.sendMessage(chatId, `✅ Tipo selecionado: *Férias*\n\nQual é o *Período Aquisitivo* (ex: 2024/2025)?`, { parse_mode: 'Markdown' });
        return;
      }
      if (valeType === '13º Salário') {
        setState(userId, STATES.AWAITING_DECIMO_PARCELA);
        await bot.sendMessage(chatId, `✅ Tipo selecionado: *13º Salário*\n\nQual é a *Parcela* (ex: 1ª Parcela, Parcela Única)?`, { parse_mode: 'Markdown' });
        return;
      }

      await bot.sendMessage(chatId, `✅ Tipo selecionado: *Vale ${valeType}*`, { parse_mode: 'Markdown' });
      await finishAndSendReceipt(bot, chatId, userId);
    }
  });

  return bot;
}

module.exports = { startBot };
