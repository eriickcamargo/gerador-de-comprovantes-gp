const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { buildReceiptHTML } = require('./template');
const { buildStatementHTML } = require('./statement_template');

const TEMP_DIR = path.join(__dirname, '../../temp');

/**
 * Lança um browser Puppeteer e renderiza HTML em PDF
 */
async function htmlToPDF(html, outputPath) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '15mm', bottom: '10mm', left: '15mm' },
    });
    console.log(`✅ PDF gerado: ${outputPath}`);
    return outputPath;
  } finally {
    await browser.close();
  }
}

/**
 * Gera um PDF a partir dos dados do recibo
 */
async function generatePDF(data, receiptNumber) {
  const html = buildReceiptHTML(data);
  const safeNumber = receiptNumber.replace(/[^a-zA-Z0-9-]/g, '');
  const outputPath = path.join(TEMP_DIR, `recibo-${safeNumber}.pdf`);
  return htmlToPDF(html, outputPath);
}

/**
 * Gera o PDF do extrato mensal de um funcionário
 * @param {Object} data - Dados do extrato (empresa, funcionário, período)
 * @param {Array}  receipts - Lista de recibos do período
 * @returns {string} Caminho do PDF gerado
 */
async function generateStatementPDF(data, receipts) {
  const html = buildStatementHTML(data, receipts);
  const safeName = (data.employeeName || 'extrato')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-zA-Z0-9]/g, '_')
    .toLowerCase();
  const outputPath = path.join(TEMP_DIR, `extrato-${safeName}-${data.year}${data.month}.pdf`);
  return htmlToPDF(html, outputPath);
}

/**
 * Remove um arquivo temporário do disco
 */
function cleanupFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error(`Erro ao deletar arquivo temporário ${filePath}:`, err.message);
  }
}

module.exports = { generatePDF, generateStatementPDF, cleanupFile };
