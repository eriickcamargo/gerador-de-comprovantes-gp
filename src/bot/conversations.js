/**
 * Gerencia o estado de conversa de cada usuário do Telegram.
 * Cada usuário tem seu próprio estado isolado.
 */

const STATES = {
  IDLE: 'IDLE',
  PROCESSING: 'PROCESSING',
  AWAITING_CARGO: 'AWAITING_CARGO',
  AWAITING_SETOR: 'AWAITING_SETOR',
  AWAITING_VALE_TYPE: 'AWAITING_VALE_TYPE',
  AWAITING_OUTRO_VALE: 'AWAITING_OUTRO_VALE',
  AWAITING_EMPRESA_NAME: 'AWAITING_EMPRESA_NAME',
  AWAITING_EMPRESA_CNPJ: 'AWAITING_EMPRESA_CNPJ',
  AWAITING_EMPRESA_ADDRESS: 'AWAITING_EMPRESA_ADDRESS',
  AWAITING_EXTRATO_PERIOD: 'AWAITING_EXTRATO_PERIOD',     // aguardando mês/ano
  AWAITING_EXTRATO_EMPLOYEE: 'AWAITING_EXTRATO_EMPLOYEE', // aguardando seleção do funcionário
};

// Map de userId -> { state, data }
const conversations = new Map();

function getConversation(userId) {
  if (!conversations.has(userId)) {
    conversations.set(userId, { state: STATES.IDLE, data: {} });
  }
  return conversations.get(userId);
}

function setState(userId, state) {
  const conv = getConversation(userId);
  conv.state = state;
}

function getState(userId) {
  return getConversation(userId).state;
}

function setData(userId, key, value) {
  const conv = getConversation(userId);
  conv.data[key] = value;
}

function getData(userId) {
  return getConversation(userId).data;
}

function resetConversation(userId) {
  conversations.set(userId, { state: STATES.IDLE, data: {} });
}

module.exports = {
  STATES,
  getState,
  setState,
  getData,
  setData,
  resetConversation,
};
