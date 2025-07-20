const assert = require('assert');
const axios = require('axios');

describe('MEV Detector Tests', () => {
  const baseUrl = 'http://localhost:3000';

  before(async () => {
    // Wait for service to start
    await new Promise(resolve => setTimeout(resolve, 5000));
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await axios.get(`${baseUrl}/health`);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.data.status, 'healthy');
    });
  });

  describe('Statistics', () => {
    it('should return statistics', async () => {
      const response = await axios.get(`${baseUrl}/stats`);
      assert.strictEqual(response.status, 200);
      assert.ok(response.data.stats);
      assert.ok(typeof response.data.stats.transactionsProcessed === 'number');
    });
  });

  describe('Mock Transaction', () => {
    it('should accept mock transaction', async () => {
      const mockTx = {
        hash: '0x1234567890abcdef',
        from: '0xabcdef1234567890',
        to: '0x0987654321fedcba',
        value: '1000000000000000000',
        gas_price: '20000000000',
        gas_limit: '21000',
        nonce: 0,
        data: '0x',
        timestamp: Math.floor(Date.now() / 1000),
        block_number: null
      };

      const response = await axios.post(`${baseUrl}/mock-transaction`, mockTx);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.data.success, true);
    });
  });
}); 