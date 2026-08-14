const axios = require('axios');
const config = require('../config');
const { isDbReady } = require('../app/db');
const donationRepo = require('../repositories/donation.repo');
const { getRuntimeSettings } = require('./adminSettings.service');
const { createAndSendDonation } = require('./donations.service');

const DONATION_SOURCE = 'usdt-trc20';
const TRONGRID_API_URL = 'https://api.trongrid.io/v1/accounts';
// Контракт USDT (TRC20) в сети TRON.
const USDT_CONTRACT_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const POLL_INTERVAL_MS = (parseInt(config.USDT_TRC20_POLL_INTERVAL, 10) || 30) * 1000; // default 30s
const RAW_MIN_AMOUNT = parseFloat(config.USDT_TRC20_MIN_AMOUNT);
// Порог отсекает dust-переводы (спам дробными суммами); 0 отключает порог.
const MIN_AMOUNT = Number.isFinite(RAW_MIN_AMOUNT) ? RAW_MIN_AMOUNT : 1;
const TRANSFER_LIMIT = 50;

let _pollTimer = null;
let _polling = false;
let _warnedNoWallet = false;

async function getWalletAddress() {
  const settings = await getRuntimeSettings();
  return String(settings.usdtTrc20WalletAddress || config.USDT_TRC20_WALLET || '').trim();
}

async function fetchIncomingTransfers(walletAddress) {
  const response = await axios.get(
    `${TRONGRID_API_URL}/${encodeURIComponent(walletAddress)}/transactions/trc20`,
    {
      params: {
        only_confirmed: true,
        only_to: true,
        contract_address: USDT_CONTRACT_ADDRESS,
        limit: TRANSFER_LIMIT,
        order_by: 'block_timestamp,desc',
      },
      headers: config.TRONGRID_API_KEY ? { 'TRON-PRO-API-KEY': config.TRONGRID_API_KEY } : undefined,
      timeout: 15000,
    }
  );
  const transfers = response.data?.data;
  return Array.isArray(transfers) ? transfers : [];
}

function shortenAddress(address) {
  const value = String(address || '');
  if (value.length <= 13) return value || 'Unknown';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * Перевод из TronGrid → данные для createAndSendDonation.
 * Возвращает null для переводов не на наш кошелёк / не USDT / без валидной суммы.
 */
function prepareUsdtDonation(transfer, walletAddress) {
  if (!transfer || transfer.type !== 'Transfer') return null;
  if (String(transfer.to) !== String(walletAddress)) return null;
  const tokenInfo = transfer.token_info || {};
  const tokenAddress = String(tokenInfo.address || USDT_CONTRACT_ADDRESS);
  if (tokenAddress !== USDT_CONTRACT_ADDRESS) return null;

  const decimals = Number(tokenInfo.decimals ?? 6);
  const amount = Number(transfer.value) / 10 ** (Number.isFinite(decimals) ? decimals : 6);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const transactionId = String(transfer.transaction_id || '');
  if (!transactionId) return null;

  return {
    externalId: transactionId,
    donorId: transactionId,
    donorName: shortenAddress(transfer.from),
    // USDT нет в списке валют StreamElements, отправляем как USD 1:1.
    amount,
    currency: 'USD',
    message: `USDT TRC20 • tx ${transactionId.slice(0, 12)}…`,
    raw: transfer,
  };
}

async function pollUsdtWallet() {
  if (_polling || !isDbReady()) return;
  _polling = true;
  try {
    const walletAddress = await getWalletAddress();
    if (!walletAddress) {
      if (!_warnedNoWallet) {
        console.log('[UsdtTrc20] Wallet address is not configured, skipping USDT polling');
        _warnedNoWallet = true;
      }
      return;
    }
    _warnedNoWallet = false;

    const transfers = await fetchIncomingTransfers(walletAddress);
    // Первый запуск (в БД нет записей этого источника): текущие переводы
    // записываются со статусом «skipped» как якоря дедупликации — алерты
    // уходят только по поступлениям после включения мониторинга.
    const isFirstRun = donationRepo.countBySource(DONATION_SOURCE) === 0;
    let baselined = 0;

    for (const transfer of transfers) {
      const donation = prepareUsdtDonation(transfer, walletAddress);
      if (!donation || donation.amount < MIN_AMOUNT) continue;

      const existing = donationRepo.findOneByExternalId(DONATION_SOURCE, donation.externalId);
      if (isFirstRun && !existing) {
        donationRepo.create({ source: DONATION_SOURCE, isTest: false, ...donation, status: 'skipped' });
        baselined += 1;
        continue;
      }
      // sent/skipped уже обработаны; failed (например, StreamElements был недоступен) — ретрай.
      if (existing && existing.status !== 'failed') continue;

      try {
        await createAndSendDonation(donation, DONATION_SOURCE);
        console.log(`[UsdtTrc20] Imported donation ${donation.amount} USD (tx ${donation.externalId})`);
      } catch (error) {
        console.error(`[UsdtTrc20] Import failed for tx ${donation.externalId}:`, error.message);
      }
    }

    if (isFirstRun) {
      console.log(`[UsdtTrc20] Baseline: marked ${baselined} existing transfer(s) as skipped`);
    }
  } catch (error) {
    console.error('[UsdtTrc20] Poll error:', error.message);
  } finally {
    _polling = false;
  }
}

function startPolling(intervalMs) {
  const interval = intervalMs || POLL_INTERVAL_MS;
  if (_pollTimer) {
    clearInterval(_pollTimer);
  }

  // Адрес кошелька читается из настроек на каждом тике, поэтому интервал
  // запускается безусловно и сам подхватывает адрес из /admin/settings или .env.
  pollUsdtWallet();

  _pollTimer = setInterval(pollUsdtWallet, interval);
  console.log(`[UsdtTrc20] Started polling every ${Math.round(interval / 1000)}s`);
}

function stopPolling() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
    console.log('[UsdtTrc20] Stopped polling');
  }
}

module.exports = {
  prepareUsdtDonation,
  pollUsdtWallet,
  startPolling,
  stopPolling,
};
