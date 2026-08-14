'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'twitch-bot-usdt-trc20-'));
process.env.SQLITE_PATH = path.join(temporaryDirectory, 'test.sqlite');

const db = require('../src/app/db');
const { prepareUsdtDonation } = require('../src/services/usdtTrc20.service');

const WALLET = 'TAZjfenZJzaXoUf7D5JpCeA9sJxVHGWtEt';

function buildTransfer(overrides = {}) {
  return {
    transaction_id: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    token_info: {
      symbol: 'USDT',
      address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      decimals: '6',
      name: 'Tether USD',
    },
    block_timestamp: 1786440015000,
    from: 'TFW7jiLdDUAkRB8aZ2eDDJHzPHztew35z5',
    to: WALLET,
    type: 'Transfer',
    value: '35850000',
    ...overrides,
  };
}

after(() => {
  if (db.open) {
    db.close();
  }
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('prepareUsdtDonation maps an incoming USDT transfer to donation data', () => {
  const donation = prepareUsdtDonation(buildTransfer(), WALLET);

  assert.equal(donation.externalId, 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2');
  assert.equal(donation.amount, 35.85);
  assert.equal(donation.currency, 'USD');
  assert.equal(donation.donorName, 'TFW7ji…35z5');
  assert.match(donation.message, /^USDT TRC20 • tx a1b2c3d4e5f6/);
  assert.equal(donation.raw.to, WALLET);
});

test('prepareUsdtDonation rejects transfers that are not incoming USDT to the wallet', () => {
  assert.equal(prepareUsdtDonation(buildTransfer({ to: 'TXoThErWaLlEtAddressNotOurs1234567' }), WALLET), null);
  assert.equal(prepareUsdtDonation(buildTransfer({ type: 'TransferFrom' }), WALLET), null);
  assert.equal(
    prepareUsdtDonation(buildTransfer({
      token_info: { symbol: 'USDC', address: 'TPk7XeYqWoaY4Cv3smqFwjhAhLA2QkPtFR', decimals: '6' },
    }), WALLET),
    null
  );
  assert.equal(prepareUsdtDonation(buildTransfer({ value: '0' }), WALLET), null);
  assert.equal(prepareUsdtDonation(buildTransfer({ value: 'abc' }), WALLET), null);
  assert.equal(prepareUsdtDonation(null, WALLET), null);
});
