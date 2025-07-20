import { BigInt, Address } from "@graphprotocol/graph-ts"
import {
  MEVAttack,
  Transaction,
  Attacker,
  Victim,
  MEVStats
} from "../generated/schema"

export function handleTransaction(event: any): void {
  let tx = new Transaction(event.transaction.hash.toHexString())
  tx.hash = event.transaction.hash.toHexString()
  tx.from = event.params.from.toHexString()
  tx.to = event.params.to.toHexString()
  tx.value = event.params.value
  tx.gasPrice = event.params.gasPrice
  tx.gasLimit = event.params.gasLimit
  tx.nonce = event.params.nonce
  tx.timestamp = event.block.timestamp
  tx.blockNumber = event.block.number
  tx.data = event.params.data.toHexString()
  
  // Detect if this is a swap transaction
  tx.isSwap = isSwapTransaction(event.params.data)
  tx.swapMethod = getSwapMethod(event.params.data)
  
  tx.save()
  
  // Update or create attacker entity
  let attacker = Attacker.load(event.params.from.toHexString())
  if (!attacker) {
    attacker = new Attacker(event.params.from.toHexString())
    attacker.address = event.params.from.toHexString()
    attacker.totalAttacks = BigInt.fromI32(0)
    attacker.totalProfit = BigInt.fromI32(0)
    attacker.firstAttack = BigInt.fromI32(0)
    attacker.lastAttack = BigInt.fromI32(0)
    attacker.attackTypes = []
  }
  attacker.save()
}

export function handleMEVAttack(event: any): void {
  let attack = new MEVAttack(event.transaction.hash.toHexString())
  attack.attacker = event.params.attacker.toHexString()
  attack.victim = event.params.victim.toHexString()
  attack.profit = event.params.profit
  attack.attackType = event.params.attackType
  attack.timestamp = event.block.timestamp
  attack.blockNumber = event.block.number
  attack.gasUsed = event.transaction.gasUsed
  attack.gasPrice = event.transaction.gasPrice
  
  // Link to transactions
  attack.frontrunTx = event.params.frontrunTx.toHexString()
  attack.victimTx = event.params.victimTx.toHexString()
  if (event.params.backrunTx) {
    attack.backrunTx = event.params.backrunTx.toHexString()
  }
  
  attack.save()
  
  // Update attacker stats
  let attacker = Attacker.load(event.params.attacker.toHexString())
  if (attacker) {
    attacker.totalAttacks = attacker.totalAttacks.plus(BigInt.fromI32(1))
    attacker.totalProfit = attacker.totalProfit.plus(event.params.profit)
    if (attacker.firstAttack.equals(BigInt.fromI32(0))) {
      attacker.firstAttack = event.block.timestamp
    }
    attacker.lastAttack = event.block.timestamp
    
    let attackTypes = attacker.attackTypes
    if (!attackTypes.includes(event.params.attackType)) {
      attackTypes.push(event.params.attackType)
      attacker.attackTypes = attackTypes
    }
    attacker.save()
  }
  
  // Update victim stats
  let victim = Victim.load(event.params.victim.toHexString())
  if (!victim) {
    victim = new Victim(event.params.victim.toHexString())
    victim.address = event.params.victim.toHexString()
    victim.totalAttacks = BigInt.fromI32(0)
    victim.totalLoss = BigInt.fromI32(0)
    victim.firstAttack = BigInt.fromI32(0)
    victim.lastAttack = BigInt.fromI32(0)
  }
  victim.totalAttacks = victim.totalAttacks.plus(BigInt.fromI32(1))
  victim.totalLoss = victim.totalLoss.plus(event.params.profit)
  if (victim.firstAttack.equals(BigInt.fromI32(0))) {
    victim.firstAttack = event.block.timestamp
  }
  victim.lastAttack = event.block.timestamp
  victim.save()
  
  // Update global stats
  updateMEVStats(event.params.profit, event.params.attackType)
}

function isSwapTransaction(data: any): boolean {
  let dataHex = data.toHexString()
  // Check for common swap method signatures
  let swapMethods = [
    "0x38ed1739", // swapExactTokensForTokens
    "0x7ff36ab5", // swapExactETHForTokens
    "0x18cbafe5", // swapExactTokensForETH
    "0xfb3bdb41", // swapTokensForExactTokens
    "0x4a25d94a", // swapETHForExactTokens
    "0x8803dbee"  // swapTokensForExactETH
  ]
  
  for (let i = 0; i < swapMethods.length; i++) {
    if (dataHex.startsWith(swapMethods[i])) {
      return true
    }
  }
  return false
}

function getSwapMethod(data: any): string {
  let dataHex = data.toHexString()
  let methodMap = new Map<string, string>()
  methodMap.set("0x38ed1739", "swapExactTokensForTokens")
  methodMap.set("0x7ff36ab5", "swapExactETHForTokens")
  methodMap.set("0x18cbafe5", "swapExactTokensForETH")
  methodMap.set("0xfb3bdb41", "swapTokensForExactTokens")
  methodMap.set("0x4a25d94a", "swapETHForExactTokens")
  methodMap.set("0x8803dbee", "swapTokensForExactETH")
  
  for (let i = 0; i < methodMap.keys().length; i++) {
    let key = methodMap.keys()[i]
    if (dataHex.startsWith(key)) {
      return methodMap.get(key)!
    }
  }
  return "unknown"
}

function updateMEVStats(profit: BigInt, attackType: string): void {
  let stats = MEVStats.load("global")
  if (!stats) {
    stats = new MEVStats("global")
    stats.totalAttacks = BigInt.fromI32(0)
    stats.totalProfit = BigInt.fromI32(0)
    stats.totalLoss = BigInt.fromI32(0)
    stats.uniqueAttackers = BigInt.fromI32(0)
    stats.uniqueVictims = BigInt.fromI32(0)
    stats.sandwichAttacks = BigInt.fromI32(0)
    stats.frontrunningAttacks = BigInt.fromI32(0)
  }
  
  stats.totalAttacks = stats.totalAttacks.plus(BigInt.fromI32(1))
  stats.totalProfit = stats.totalProfit.plus(profit)
  stats.totalLoss = stats.totalLoss.plus(profit)
  stats.lastUpdated = BigInt.fromI32(0) // Will be set to current timestamp
  
  if (attackType == "sandwich") {
    stats.sandwichAttacks = stats.sandwichAttacks.plus(BigInt.fromI32(1))
  } else if (attackType == "frontrunning") {
    stats.frontrunningAttacks = stats.frontrunningAttacks.plus(BigInt.fromI32(1))
  }
  
  stats.save()
} 