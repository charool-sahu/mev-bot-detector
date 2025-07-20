const { ethers } = require('ethers');
const axios = require('axios');

class LoadTester {
    constructor() {
        this.baseUrl = 'http://localhost:3000';
        this.stats = {
            transactionsSent: 0,
            attacksDetected: 0,
            startTime: Date.now()
        };
    }

    async start() {
        console.log('🚀 Starting MEV Bot Detector Load Test');
        console.log('Target: 10,000 TPS simulation');
        console.log('Duration: 5 minutes');
        console.log('========================');

        // Start monitoring stats
        this.startStatsMonitoring();

        // Start transaction simulation
        await this.simulateTransactions();

        // Wait for 5 minutes
        setTimeout(() => {
            this.stop();
        }, 5 * 60 * 1000);
    }

    async simulateTransactions() {
        const targetTPS = 10000;
        const interval = 1000 / targetTPS; // Time between transactions in ms

        // Create multiple concurrent streams to achieve high TPS
        const numStreams = 10;
        const tpsPerStream = Math.ceil(targetTPS / numStreams);

        for (let i = 0; i < numStreams; i++) {
            this.startTransactionStream(i, tpsPerStream);
        }
    }

    startTransactionStream(streamId, tpsPerStream) {
        const interval = 1000 / tpsPerStream;
        
        setInterval(() => {
            this.sendMockTransaction(streamId);
        }, interval);
    }

    async sendMockTransaction(streamId) {
        try {
            // Generate a realistic mock transaction
            const mockTx = this.generateMockTransaction();
            
            // Send to the MEV detector via HTTP endpoint
            await axios.post(`${this.baseUrl}/mock-transaction`, mockTx, {
                timeout: 1000
            });

            this.stats.transactionsSent++;
        } catch (error) {
            // Ignore errors for load testing
        }
    }

    generateMockTransaction() {
        const now = Math.floor(Date.now() / 1000);
        
        // Generate random addresses
        const from = `0x${this.randomHex(40)}`;
        const to = `0x${this.randomHex(40)}`;
        
        // Generate random transaction data
        const isSwap = Math.random() > 0.7; // 30% chance of being a swap
        const data = isSwap ? this.generateSwapData() : this.randomHex(64);
        
        // Generate realistic gas prices
        const baseGasPrice = 20000000000; // 20 gwei
        const gasPriceVariation = Math.random() * 0.5 + 0.75; // 75% to 125% of base
        const gasPrice = Math.floor(baseGasPrice * gasPriceVariation);
        
        return {
            hash: `0x${this.randomHex(64)}`,
            from: from,
            to: to,
            value: (Math.random() * 10).toString(), // 0-10 ETH
            gas_price: gasPrice.toString(),
            gas_limit: (Math.floor(Math.random() * 500000) + 21000).toString(),
            nonce: Math.floor(Math.random() * 1000),
            data: data,
            timestamp: now + Math.floor(Math.random() * 60) - 30, // ±30 seconds from now
            block_number: null
        };
    }

    generateSwapData() {
        // Generate realistic Uniswap swap data
        const swapMethods = [
            '0xa9059cbb', // transfer
            '0x23b872dd', // transferFrom
            '0x095ea7b3', // approve
            '0x38ed1739', // swapExactTokensForTokens
            '0x7ff36ab5', // swapExactETHForTokens
            '0x18cbafe5'  // swapExactTokensForETH
        ];
        
        const method = swapMethods[Math.floor(Math.random() * swapMethods.length)];
        const params = this.randomHex(64);
        
        return method + params;
    }

    randomHex(length) {
        const chars = '0123456789abcdef';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars[Math.floor(Math.random() * chars.length)];
        }
        return result;
    }

    async startStatsMonitoring() {
        setInterval(async () => {
            try {
                const response = await axios.get(`${this.baseUrl}/stats`);
                const stats = response.data;
                
                const elapsed = (Date.now() - this.stats.startTime) / 1000;
                const currentTPS = this.stats.transactionsSent / elapsed;
                
                console.log(`\n📊 Load Test Stats (${Math.floor(elapsed)}s elapsed):`);
                console.log(`   Transactions Sent: ${this.stats.transactionsSent.toLocaleString()}`);
                console.log(`   Current TPS: ${currentTPS.toFixed(2)}`);
                console.log(`   Attacks Detected: ${stats.stats.attacksDetected}`);
                console.log(`   Alerts Sent: ${stats.stats.alertsSent}`);
                console.log(`   Clusters: ${stats.clusterCount}`);
                console.log(`   Pending TXs: ${stats.pendingTransactions}`);
                
                // Update our stats
                this.stats.attacksDetected = stats.stats.attacksDetected;
                
            } catch (error) {
                console.log('❌ Failed to fetch stats:', error.message);
            }
        }, 10000); // Update every 10 seconds
    }

    async stop() {
        console.log('\n🛑 Load test completed!');
        console.log('========================');
        
        try {
            const response = await axios.get(`${this.baseUrl}/stats`);
            const stats = response.data;
            
            const elapsed = (Date.now() - this.stats.startTime) / 1000;
            const avgTPS = this.stats.transactionsSent / elapsed;
            
            console.log('📈 Final Results:');
            console.log(`   Total Transactions: ${this.stats.transactionsSent.toLocaleString()}`);
            console.log(`   Average TPS: ${avgTPS.toFixed(2)}`);
            console.log(`   Total Attacks Detected: ${stats.stats.attacksDetected}`);
            console.log(`   Total Alerts Sent: ${stats.stats.alertsSent}`);
            console.log(`   Test Duration: ${Math.floor(elapsed)}s`);
            
        } catch (error) {
            console.log('❌ Failed to fetch final stats:', error.message);
        }
        
        process.exit(0);
    }
}

// Start the load test
const loadTester = new LoadTester();
loadTester.start().catch((error) => {
    console.error('Load test failed:', error);
    process.exit(1);
}); 