use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub hash: String,
    pub from: String,
    pub to: String,
    pub value: String,
    pub gas_price: String,
    pub gas_limit: String,
    pub nonce: u64,
    pub data: String,
    pub timestamp: u64,
    pub block_number: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MEVAttack {
    pub victim: String,
    pub attacker: String,
    pub profit_eth: f64,
    pub timestamp: u64,
    pub attack_type: String,
    pub frontrun_tx: String,
    pub backrun_tx: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionCluster {
    pub transactions: Vec<Transaction>,
    pub cluster_id: String,
    pub timestamp: u64,
}

#[wasm_bindgen]
pub struct MEVEngine {
    clusters: HashMap<String, TransactionCluster>,
    known_attackers: HashMap<String, u64>,
}

#[wasm_bindgen]
impl MEVEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> MEVEngine {
        MEVEngine {
            clusters: HashMap::new(),
            known_attackers: HashMap::new(),
        }
    }

    pub fn add_transaction(&mut self, tx_json: &str) -> Result<JsValue, JsValue> {
        let tx: Transaction = serde_json::from_str(tx_json)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse transaction: {}", e)))?;
        
        self.process_transaction(tx);
        Ok(JsValue::NULL)
    }

    pub fn detect_mev_attacks(&self) -> Result<JsValue, JsValue> {
        let attacks = self.analyze_clusters();
        let attacks_json = serde_json::to_string(&attacks)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize attacks: {}", e)))?;
        
        Ok(JsValue::from_str(&attacks_json))
    }

    pub fn get_cluster_count(&self) -> usize {
        self.clusters.len()
    }
}

impl MEVEngine {
    fn process_transaction(&mut self, tx: Transaction) {
        // Group transactions by time window (2 minutes)
        let cluster_key = self.get_cluster_key(&tx);
        
        let cluster = self.clusters.entry(cluster_key.clone()).or_insert_with(|| {
            TransactionCluster {
                transactions: Vec::new(),
                cluster_id: cluster_key,
                timestamp: tx.timestamp,
            }
        });
        
        cluster.transactions.push(tx);
        
        // Keep only recent transactions (last 10 minutes)
        self.cleanup_old_clusters();
    }

    fn get_cluster_key(&self, tx: &Transaction) -> String {
        // Group transactions by 2-minute time windows
        let window = tx.timestamp / 120; // 120 seconds = 2 minutes
        format!("cluster_{}", window)
    }

    fn cleanup_old_clusters(&mut self) {
        let current_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        let cutoff_time = current_time - 600; // 10 minutes ago
        
        self.clusters.retain(|_, cluster| cluster.timestamp > cutoff_time);
    }

    fn analyze_clusters(&self) -> Vec<MEVAttack> {
        let mut attacks = Vec::new();
        
        for cluster in self.clusters.values() {
            if cluster.transactions.len() < 3 {
                continue;
            }
            
            // Sort transactions by timestamp
            let mut sorted_txs = cluster.transactions.clone();
            sorted_txs.sort_by_key(|tx| tx.timestamp);
            
            // Detect sandwich attacks
            if let Some(sandwich) = self.detect_sandwich_attack(&sorted_txs) {
                attacks.push(sandwich);
            }
            
            // Detect front-running
            if let Some(frontrun) = self.detect_frontrunning(&sorted_txs) {
                attacks.push(frontrun);
            }
        }
        
        attacks
    }

    fn detect_sandwich_attack(&self, transactions: &[Transaction]) -> Option<MEVAttack> {
        for i in 1..transactions.len() - 1 {
            let frontrun = &transactions[i - 1];
            let victim = &transactions[i];
            let backrun = &transactions[i + 1];
            
            // Check if this looks like a sandwich attack
            if self.is_sandwich_pattern(frontrun, victim, backrun) {
                let profit = self.calculate_profit(frontrun, victim, backrun);
                
                return Some(MEVAttack {
                    victim: victim.from.clone(),
                    attacker: frontrun.from.clone(),
                    profit_eth: profit,
                    timestamp: victim.timestamp,
                    attack_type: "sandwich".to_string(),
                    frontrun_tx: frontrun.hash.clone(),
                    backrun_tx: backrun.hash.clone(),
                });
            }
        }
        
        None
    }

    fn detect_frontrunning(&self, transactions: &[Transaction]) -> Option<MEVAttack> {
        for i in 0..transactions.len() - 1 {
            let frontrun = &transactions[i];
            let victim = &transactions[i + 1];
            
            // Check if this looks like front-running
            if self.is_frontrunning_pattern(frontrun, victim) {
                let profit = self.calculate_frontrun_profit(frontrun, victim);
                
                return Some(MEVAttack {
                    victim: victim.from.clone(),
                    attacker: frontrun.from.clone(),
                    profit_eth: profit,
                    timestamp: victim.timestamp,
                    attack_type: "frontrunning".to_string(),
                    frontrun_tx: frontrun.hash.clone(),
                    backrun_tx: "".to_string(),
                });
            }
        }
        
        None
    }

    fn is_sandwich_pattern(&self, frontrun: &Transaction, victim: &Transaction, backrun: &Transaction) -> bool {
        // Check if all three transactions are from the same attacker
        if frontrun.from != backrun.from {
            return false;
        }
        
        // Check if victim is different from attacker
        if victim.from == frontrun.from {
            return false;
        }
        
        // Check time constraints (within 2 minutes)
        let time_diff = backrun.timestamp - frontrun.timestamp;
        if time_diff > 120 {
            return false;
        }
        
        // Check if victim transaction is a swap (has data)
        if victim.data.len() < 10 {
            return false;
        }
        
        // Check gas price patterns (attacker pays higher gas)
        let frontrun_gas: u64 = frontrun.gas_price.parse().unwrap_or(0);
        let victim_gas: u64 = victim.gas_price.parse().unwrap_or(0);
        let backrun_gas: u64 = backrun.gas_price.parse().unwrap_or(0);
        
        frontrun_gas > victim_gas && backrun_gas > victim_gas
    }

    fn is_frontrunning_pattern(&self, frontrun: &Transaction, victim: &Transaction) -> bool {
        // Check if attacker is different from victim
        if frontrun.from == victim.from {
            return false;
        }
        
        // Check time constraints (within 30 seconds)
        let time_diff = victim.timestamp - frontrun.timestamp;
        if time_diff > 30 {
            return false;
        }
        
        // Check if both are swap transactions
        if frontrun.data.len() < 10 || victim.data.len() < 10 {
            return false;
        }
        
        // Check gas price (attacker pays higher gas)
        let frontrun_gas: u64 = frontrun.gas_price.parse().unwrap_or(0);
        let victim_gas: u64 = victim.gas_price.parse().unwrap_or(0);
        
        frontrun_gas > victim_gas
    }

    fn calculate_profit(&self, frontrun: &Transaction, victim: &Transaction, backrun: &Transaction) -> f64 {
        // Simplified profit calculation
        // In a real implementation, you would analyze the actual token amounts and prices
        let frontrun_value: f64 = frontrun.value.parse().unwrap_or(0.0) / 1e18;
        let backrun_value: f64 = backrun.value.parse().unwrap_or(0.0) / 1e18;
        
        // Estimate profit as the difference between backrun and frontrun values
        (backrun_value - frontrun_value).max(0.0)
    }

    fn calculate_frontrun_profit(&self, frontrun: &Transaction, victim: &Transaction) -> f64 {
        // Simplified front-running profit calculation
        let frontrun_value: f64 = frontrun.value.parse().unwrap_or(0.0) / 1e18;
        let victim_value: f64 = victim.value.parse().unwrap_or(0.0) / 1e18;
        
        // Estimate profit as a percentage of the victim's transaction
        (victim_value * 0.01).max(0.0) // 1% of victim's transaction value
    }
}

#[wasm_bindgen]
pub fn detect_mev(tx_batch_json: &str) -> Result<JsValue, JsValue> {
    let mut engine = MEVEngine::new();
    let tx_batch: Vec<Transaction> = serde_json::from_str(tx_batch_json)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse transaction batch: {}", e)))?;
    
    for tx in tx_batch {
        let tx_json = serde_json::to_string(&tx)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize transaction: {}", e)))?;
        engine.add_transaction(&tx_json)?;
    }
    
    engine.detect_mev_attacks()
} 