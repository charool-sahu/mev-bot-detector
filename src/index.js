const { ethers } = require('ethers');
const Redis = require('redis');
const { Kafka } = require('kafkajs');
const winston = require('winston');
const cors = require('cors');
const express = require('express');
const path = require('path');

// Import the Rust WASM module
const mevEngine = require('../rust/pkg/mev_engine');

// Configuration
const config = {
    ethereum: {
        wsUrl: process.env.ETHEREUM_WS_URL || 'wss://mainnet.infura.io/ws/v3/YOUR_PROJECT_ID',
        rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://mainnet.infura.io/v3/YOUR_PROJECT_ID'
    },
    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379'
    },
    kafka: {
        clientId: 'mev-detector',
        brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
        topic: 'mev-alerts'
    },
    server: {
        port: process.env.PORT || 3000
    }
};

// Initialize logging
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/mev-detector.log' })
    ]
});

// Initialize Redis client
const redisClient = Redis.createClient({
    url: config.redis.url
});

redisClient.on('error', (err) => logger.error('Redis Client Error', err));
redisClient.on('connect', () => logger.info('Connected to Redis'));

// Initialize Kafka producer
const kafka = new Kafka({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers
});

const producer = kafka.producer();

// Initialize Express server
const app = express();
app.use(cors());
app.use(express.json());

// MEV Detection Service
class MEVDetector {
    constructor() {
        this.provider = new ethers.WebSocketProvider(config.ethereum.wsUrl);
        this.engine = new mevEngine.MEVEngine();
        this.pendingTransactions = [];
        this.isProcessing = false;
        this.stats = {
            transactionsProcessed: 0,
            attacksDetected: 0,
            alertsSent: 0
        };
    }

    async start() {
        try {
            await redisClient.connect();
            await producer.connect();
            
            logger.info('Starting MEV Detector...');
            
            // Start monitoring pending transactions
            this.monitorPendingTransactions();
            
            // Start processing batches
            this.startBatchProcessing();
            
            // Start HTTP server
            this.startServer();
            
            logger.info('MEV Detector started successfully');
        } catch (error) {
            logger.error('Failed to start MEV Detector:', error);
            process.exit(1);
        }
    }

    monitorPendingTransactions() {
        this.provider.on('pending', async (txHash) => {
            try {
                const tx = await this.provider.getTransaction(txHash);
                if (tx) {
                    this.addTransaction(tx);
                }
            } catch (error) {
                logger.error('Error processing pending transaction:', error);
            }
        });

        logger.info('Monitoring pending transactions...');
    }

    addTransaction(tx) {
        const transaction = {
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            value: tx.value.toString(),
            gas_price: tx.gasPrice.toString(),
            gas_limit: tx.gasLimit.toString(),
            nonce: tx.nonce,
            data: tx.data,
            timestamp: Math.floor(Date.now() / 1000),
            block_number: null
        };

        this.pendingTransactions.push(transaction);
        this.stats.transactionsProcessed++;

        // Keep only last 1000 transactions
        if (this.pendingTransactions.length > 1000) {
            this.pendingTransactions = this.pendingTransactions.slice(-1000);
        }
    }

    async startBatchProcessing() {
        setInterval(async () => {
            if (this.isProcessing || this.pendingTransactions.length === 0) {
                return;
            }

            this.isProcessing = true;
            try {
                await this.processBatch();
            } catch (error) {
                logger.error('Error processing batch:', error);
            } finally {
                this.isProcessing = false;
            }
        }, 5000); // Process every 5 seconds
    }

    async processBatch() {
        const batch = this.pendingTransactions.splice(0, 100); // Process 100 transactions at a time
        
        if (batch.length === 0) return;

        try {
            // Add transactions to Rust engine
            for (const tx of batch) {
                const txJson = JSON.stringify(tx);
                this.engine.add_transaction(txJson);
            }

            // Detect MEV attacks
            const attacksJson = this.engine.detect_mev_attacks();
            const attacks = JSON.parse(attacksJson);

            // Process detected attacks
            for (const attack of attacks) {
                await this.processAttack(attack);
            }

            logger.info(`Processed ${batch.length} transactions, detected ${attacks.length} attacks`);
        } catch (error) {
            logger.error('Error in batch processing:', error);
        }
    }

    async processAttack(attack) {
        try {
            // Check Redis for deduplication
            const cacheKey = `mev:${attack.attacker}:last_alert`;
            const lastAlert = await redisClient.get(cacheKey);
            
            if (lastAlert) {
                logger.debug(`Skipping duplicate alert for attacker ${attack.attacker}`);
                return;
            }

            // Cache the alert for 5 minutes
            await redisClient.setEx(cacheKey, 300, JSON.stringify(attack));

            // Send to Kafka
            await this.sendAlert(attack);

            this.stats.attacksDetected++;
            this.stats.alertsSent++;

            logger.info(`MEV Attack detected: ${attack.attack_type} by ${attack.attacker}`, {
                victim: attack.victim,
                profit: attack.profit_eth,
                timestamp: attack.timestamp
            });

        } catch (error) {
            logger.error('Error processing attack:', error);
        }
    }

    async sendAlert(attack) {
        try {
            const message = {
                victim: attack.victim,
                attacker: attack.attacker,
                profit_eth: attack.profit_eth,
                timestamp: attack.timestamp,
                attack_type: attack.attack_type,
                frontrun_tx: attack.frontrun_tx,
                backrun_tx: attack.backrun_tx
            };

            await producer.send({
                topic: config.kafka.topic,
                messages: [
                    {
                        key: attack.attacker,
                        value: JSON.stringify(message)
                    }
                ]
            });

            logger.info(`Alert sent to Kafka: ${attack.attack_type} attack`);
        } catch (error) {
            logger.error('Error sending alert to Kafka:', error);
        }
    }

    startServer() {
        // Health check endpoint
        app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                uptime: process.uptime(),
                stats: this.stats,
                clusterCount: this.engine.get_cluster_count()
            });
        });

        // Stats endpoint
        app.get('/stats', (req, res) => {
            res.json({
                stats: this.stats,
                clusterCount: this.engine.get_cluster_count(),
                pendingTransactions: this.pendingTransactions.length
            });
        });

        // Recent attacks endpoint
        app.get('/attacks', async (req, res) => {
            try {
                const attacks = [];
                const keys = await redisClient.keys('mev:*:last_alert');
                
                for (const key of keys.slice(0, 10)) { // Get last 10 attacks
                    const attackData = await redisClient.get(key);
                    if (attackData) {
                        attacks.push(JSON.parse(attackData));
                    }
                }
                
                res.json(attacks);
            } catch (error) {
                logger.error('Error fetching recent attacks:', error);
                res.status(500).json({ error: 'Failed to fetch attacks' });
            }
        });

        // Mock transaction endpoint for load testing
        app.post('/mock-transaction', (req, res) => {
            try {
                const mockTx = req.body;
                this.addTransaction(mockTx);
                res.json({ success: true, message: 'Mock transaction added' });
            } catch (error) {
                logger.error('Error processing mock transaction:', error);
                res.status(500).json({ error: 'Failed to process mock transaction' });
            }
        });

        app.listen(config.server.port, () => {
            logger.info(`HTTP server started on port ${config.server.port}`);
        });
    }

    async stop() {
        try {
            await this.provider.destroy();
            await redisClient.quit();
            await producer.disconnect();
            logger.info('MEV Detector stopped');
        } catch (error) {
            logger.error('Error stopping MEV Detector:', error);
        }
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    if (detector) {
        await detector.stop();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    if (detector) {
        await detector.stop();
    }
    process.exit(0);
});

// Start the detector
const detector = new MEVDetector();
detector.start().catch((error) => {
    logger.error('Failed to start detector:', error);
    process.exit(1);
}); 