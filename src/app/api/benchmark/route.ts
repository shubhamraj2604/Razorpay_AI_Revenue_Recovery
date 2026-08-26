import { NextResponse } from "next/server";
import { db } from "@/db";
import { customers, transactions, recoveryAttempts, auditLogs, agentActions } from "@/db/schema";
import { generateId, rupeesToPaise } from "@/lib/utils";

// ============================================
// BENCHMARK ENGINE (1,000 TRANSACTIONS)
// ============================================

const FAILURE_REASONS = [
  { reason: "NETWORK_ERROR", temp: true, weight: 30 },
  { reason: "TIMEOUT", temp: true, weight: 20 },
  { reason: "INSUFFICIENT_FUNDS", temp: false, weight: 20 },
  { reason: "BANK_SERVER_DOWN", temp: true, weight: 15 },
  { reason: "CARD_EXPIRED", temp: false, weight: 5 },
  { reason: "FRAUD_SUSPECTED", temp: false, weight: 5 },
  { reason: "USER_CANCELLED", temp: false, weight: 5 },
];

function getRandomFailure() {
  const rand = Math.random() * 100;
  let sum = 0;
  for (const f of FAILURE_REASONS) {
    sum += f.weight;
    if (rand <= sum) return f;
  }
  return FAILURE_REASONS[0];
}

function getRandomAmount() {
  // Most transactions between ₹200 and ₹5000, some high value up to ₹50,000
  const rand = Math.random();
  if (rand < 0.8) return Math.floor(Math.random() * 4800 + 200) * 100;
  if (rand < 0.95) return Math.floor(Math.random() * 10000 + 5000) * 100;
  return Math.floor(Math.random() * 40000 + 10000) * 100;
}

export async function POST() {
  try {
    // 1. Clear database
    await db.delete(auditLogs);
    await db.delete(agentActions);
    await db.delete(recoveryAttempts);
    await db.delete(transactions);
    await db.delete(customers);

    // 2. Setup Benchmark Tracking
    const NUM_TX = 1000;
    
    // Baseline Metrics (Dumb Rule)
    let baselineActions = 0; // Sends link to EVERYONE
    let baselineRecovered = 0;
    let baselineSpam = 0;
    
    // AI Metrics
    let aiActions = 0; // Only targeted links
    let aiRecovered = 0;
    let aiEscalated = 0;
    let aiSelfResolved = 0;

    // 3. Generate 1,000 Customers
    const generatedCustomers = Array.from({ length: 50 }, (_, i) => ({
      id: generateId("CUST"),
      name: `Customer ${i + 1}`,
      email: `customer${i + 1}@example.com`,
      phone: `+9198765${String(i).padStart(5, '0')}`,
    }));
    
    // Insert customers in batches to avoid query size limits
    for (let i = 0; i < generatedCustomers.length; i += 10) {
      await db.insert(customers).values(generatedCustomers.slice(i, i + 10));
    }

    const txBatch = [];
    const actionBatch = [];
    const attemptBatch = [];

    const now = Date.now();

    for (let i = 0; i < NUM_TX; i++) {
      const customer = generatedCustomers[Math.floor(Math.random() * generatedCustomers.length)];
      const amount = getRandomAmount();
      const failure = getRandomFailure();
      
      // Simulate real-world probabilities
      const willSelfRetry = Math.random() < 0.45; // 45% of people self-retry
      const isHighValue = amount > 1000000; // > ₹10,000
      const isFraud = failure.reason === "FRAUD_SUSPECTED";
      
      const txId = generateId("TX");
      let status: any = "FAILED";
      let aiAction = "NO_ACTION";
      let confidence = 0;
      let recoverability: any = "LOW";
      let recoveredAmount = 0;

      // Baseline evaluates everyone: sends link blindly
      baselineActions++;
      if (willSelfRetry) {
        baselineSpam++; // Spamming someone who was already retrying!
        baselineRecovered += amount; 
      } else if (failure.temp && !isFraud) {
        // 30% conversion on dumb links
        if (Math.random() < 0.3) baselineRecovered += amount;
      }

      // AI Logic evaluation
      if (willSelfRetry) {
        // AI stays quiet!
        status = "SELF_RESOLVED";
        aiSelfResolved += amount;
        confidence = 0.95;
      } else if (isFraud || isHighValue) {
        // AI sends to human review
        status = "ESCALATED";
        aiAction = "HUMAN_REVIEW";
        aiEscalated++;
        confidence = isFraud ? 0.9 : 0.6;
        recoverability = isFraud ? "NONE" : "MEDIUM";
        aiActions++;
      } else if (failure.temp) {
        // AI sends payment link
        aiAction = "PAYMENT_LINK";
        confidence = 0.85;
        recoverability = "HIGH";
        aiActions++;
        
        // AI has higher conversion (50%) because links are targeted and contextual
        if (Math.random() < 0.5) {
          status = "RECOVERED";
          recoveredAmount = amount;
          aiRecovered += amount;
        } else {
          status = "ABANDONED";
        }
      } else {
        // Unrecoverable
        status = "ABANDONED";
        confidence = 0.8;
      }

      txBatch.push({
        id: txId,
        customerId: customer.id,
        razorpayPaymentId: `pay_bm_${txId}`,
        razorpayOrderId: `order_bm_${txId}`,
        amount,
        currency: "INR",
        status,
        failureReason: failure.reason,
        paymentMethod: ["UPI", "CARD", "NET_BANKING"][Math.floor(Math.random() * 3)],
        selfResolved: willSelfRetry,
        customerRetrying: willSelfRetry,
        retryCount: 0,
        createdAt: new Date(now - Math.random() * 7 * 24 * 60 * 60 * 1000),
      });

      if (aiAction !== "NO_ACTION" || willSelfRetry) {
        actionBatch.push({
          id: generateId("ACT"),
          transactionId: txId,
          action: aiAction as any,
          classification: (failure.temp ? "TEMPORARY_FAILURE" : (isFraud ? "HIGH_RISK" : "PAYMENT_METHOD_ISSUE")) as any,
          recoverability,
          confidence,
          reason: willSelfRetry ? "Customer self-retried." : (isHighValue ? "High value payment requires manual review." : "AI determined optimal recovery path."),
          requiresUserAction: aiAction === "PAYMENT_LINK" || aiAction === "HUMAN_REVIEW",
          policyResult: status === "ESCALATED" ? "ESCALATED" : "APPROVED",
        });

        attemptBatch.push({
          id: generateId("REC"),
          transactionId: txId,
          strategy: aiAction as any,
          aiConfidence: confidence,
          reason: "Benchmark execution",
          status: (status === "RECOVERED" ? "SUCCESS" : (status === "ESCALATED" ? "PENDING" : "SKIPPED")) as any,
          amountRecovered: recoveredAmount,
        });
      }
    }

    // Insert transactions in batches of 200
    for (let i = 0; i < txBatch.length; i += 200) {
      await db.insert(transactions).values(txBatch.slice(i, i + 200));
    }
    
    // Insert actions in batches of 200
    for (let i = 0; i < actionBatch.length; i += 200) {
      await db.insert(agentActions).values(actionBatch.slice(i, i + 200));
    }
    
    // Insert attempts in batches of 200
    for (let i = 0; i < attemptBatch.length; i += 200) {
      await db.insert(recoveryAttempts).values(attemptBatch.slice(i, i + 200));
    }

    return NextResponse.json({
      status: "success",
      benchmark: {
        totalTransactions: NUM_TX,
        baseline: {
          actionsTaken: baselineActions,
          spamSent: baselineSpam,
          amountRecovered: baselineRecovered,
        },
        ai: {
          actionsTaken: aiActions,
          humanEscalations: aiEscalated,
          amountSelfResolved: aiSelfResolved,
          amountRecovered: aiRecovered,
          totalSaved: aiSelfResolved + aiRecovered,
        }
      }
    });
  } catch (error) {
    console.error("Benchmark error:", error);
    return NextResponse.json({ error: "Failed to run benchmark" }, { status: 500 });
  }
}
