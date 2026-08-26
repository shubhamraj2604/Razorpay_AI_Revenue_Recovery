import { NextResponse } from "next/server";
import { db } from "@/db";
import { customers, transactions, recoveryAttempts, auditLogs, agentActions } from "@/db/schema";
import { generateId } from "@/lib/utils";

// ============================================
// SEED DATABASE WITH DEMO DATA
// ============================================

const SEED_CUSTOMERS = [
  { id: "CUST_001", name: "Rahul Sharma", email: "rahul@example.com", phone: "+919876543210" },
  { id: "CUST_002", name: "Priya Patel", email: "priya@example.com", phone: "+919876543211" },
  { id: "CUST_003", name: "Amit Kumar", email: "amit@example.com", phone: "+919876543212" },
  { id: "CUST_004", name: "Sneha Reddy", email: "sneha@example.com", phone: "+919876543213" },
  { id: "CUST_005", name: "Vikram Singh", email: "vikram@example.com", phone: "+919876543214" },
  { id: "CUST_006", name: "Ananya Iyer", email: "ananya@example.com", phone: "+919876543215" },
  { id: "CUST_007", name: "Rohan Mehta", email: "rohan@example.com", phone: "+919876543216" },
  { id: "CUST_008", name: "Kavita Nair", email: "kavita@example.com", phone: "+919876543217" },
  { id: "CUST_009", name: "Deepak Joshi", email: "deepak@example.com", phone: "+919876543218" },
  { id: "CUST_010", name: "Meera Gupta", email: "meera@example.com", phone: "+919876543219" },
];

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

const SEED_TRANSACTIONS = [
  // ─── RECOVERED (AI recovered successfully) ───
  {
    id: "TX_SEED_001",
    customerId: "CUST_001",
    amount: 249900, // ₹2,499
    status: "RECOVERED" as const,
    failureReason: "NETWORK_ERROR: Payment failed due to network issues",
    paymentMethod: "UPI",
    selfResolved: false,
    customerRetrying: false,
    createdAt: hoursAgo(48),
  },
  {
    id: "TX_SEED_002",
    customerId: "CUST_005",
    amount: 149900, // ₹1,499
    status: "RECOVERED" as const,
    failureReason: "TIMEOUT: Payment request timed out",
    paymentMethod: "CARD",
    selfResolved: false,
    customerRetrying: false,
    createdAt: hoursAgo(36),
  },
  {
    id: "TX_SEED_003",
    customerId: "CUST_007",
    amount: 599900, // ₹5,999
    status: "RECOVERED" as const,
    failureReason: "GATEWAY_ERROR: Payment gateway temporarily unavailable",
    paymentMethod: "UPI",
    selfResolved: false,
    customerRetrying: false,
    createdAt: hoursAgo(24),
  },

  // ─── SELF-RESOLVED (customer fixed it themselves) ───
  {
    id: "TX_SEED_004",
    customerId: "CUST_002",
    amount: 89900, // ₹899
    status: "SELF_RESOLVED" as const,
    failureReason: "TIMEOUT: Payment request timed out",
    paymentMethod: "CARD",
    selfResolved: true,
    customerRetrying: true,
    createdAt: hoursAgo(42),
  },
  {
    id: "TX_SEED_005",
    customerId: "CUST_006",
    amount: 199900, // ₹1,999
    status: "SELF_RESOLVED" as const,
    failureReason: "NETWORK_ERROR: Temporary connectivity issue",
    paymentMethod: "UPI",
    selfResolved: true,
    customerRetrying: true,
    createdAt: hoursAgo(30),
  },
  {
    id: "TX_SEED_006",
    customerId: "CUST_008",
    amount: 349900, // ₹3,499
    status: "SELF_RESOLVED" as const,
    failureReason: "BANK_SERVER: Bank server temporarily unavailable",
    paymentMethod: "NET_BANKING",
    selfResolved: true,
    customerRetrying: true,
    createdAt: hoursAgo(20),
  },

  // ─── ESCALATED (sent to human review) ───
  {
    id: "TX_SEED_007",
    customerId: "CUST_003",
    amount: 2850000, // ₹28,500
    status: "ESCALATED" as const,
    failureReason: "BANK_DECLINED: Transaction declined by issuing bank",
    paymentMethod: "CARD",
    selfResolved: false,
    customerRetrying: false,
    createdAt: hoursAgo(12),
  },
  {
    id: "TX_SEED_008",
    customerId: "CUST_009",
    amount: 4500000, // ₹45,000
    status: "ESCALATED" as const,
    failureReason: "FRAUD_SUSPECTED: Transaction flagged for review",
    paymentMethod: "CARD",
    selfResolved: false,
    customerRetrying: false,
    createdAt: hoursAgo(8),
  },

  // ─── FAILED (still pending) ───
  {
    id: "TX_SEED_009",
    customerId: "CUST_004",
    amount: 120000, // ₹1,200
    status: "FAILED" as const,
    failureReason: "INSUFFICIENT_FUNDS: Insufficient balance in account",
    paymentMethod: "CARD",
    selfResolved: false,
    customerRetrying: false,
    createdAt: hoursAgo(4),
  },
  {
    id: "TX_SEED_010",
    customerId: "CUST_010",
    amount: 299900, // ₹2,999
    status: "COOLDOWN" as const,
    failureReason: "USER_CANCELLED: Customer cancelled the payment",
    paymentMethod: "UPI",
    selfResolved: false,
    customerRetrying: false,
    createdAt: hoursAgo(0.2),
  },

  // ─── ABANDONED (unrecoverable) ───
  {
    id: "TX_SEED_011",
    customerId: "CUST_004",
    amount: 49900, // ₹499
    status: "ABANDONED" as const,
    failureReason: "CARD_EXPIRED: Card has expired",
    paymentMethod: "CARD",
    selfResolved: false,
    customerRetrying: false,
    createdAt: hoursAgo(72),
  },

  // ─── More RECOVERED for better metrics ───
  {
    id: "TX_SEED_012",
    customerId: "CUST_001",
    amount: 199900, // ₹1,999
    status: "RECOVERED" as const,
    failureReason: "NETWORK_ERROR: Temporary network failure",
    paymentMethod: "UPI",
    selfResolved: false,
    customerRetrying: false,
    createdAt: hoursAgo(60),
  },
  {
    id: "TX_SEED_013",
    customerId: "CUST_006",
    amount: 399900, // ₹3,999
    status: "RECOVERED" as const,
    failureReason: "TIMEOUT: Gateway timeout",
    paymentMethod: "CARD",
    selfResolved: false,
    customerRetrying: false,
    createdAt: hoursAgo(50),
  },
  {
    id: "TX_SEED_014",
    customerId: "CUST_002",
    amount: 79900, // ₹799
    status: "SELF_RESOLVED" as const,
    failureReason: "NETWORK_ERROR: Brief connectivity issue",
    paymentMethod: "UPI",
    selfResolved: true,
    customerRetrying: true,
    createdAt: hoursAgo(55),
  },
  {
    id: "TX_SEED_015",
    customerId: "CUST_007",
    amount: 159900, // ₹1,599
    status: "RECOVERED" as const,
    failureReason: "GATEWAY_ERROR: Temporary gateway issue",
    paymentMethod: "UPI",
    selfResolved: false,
    customerRetrying: false,
    createdAt: hoursAgo(40),
  },
];

// Agent actions for recovered/escalated transactions
const SEED_AGENT_ACTIONS = [
  {
    transactionId: "TX_SEED_001",
    action: "PAYMENT_LINK" as const,
    classification: "TEMPORARY_FAILURE" as const,
    recoverability: "HIGH" as const,
    confidence: 0.91,
    reason: "Customer has strong payment history. Failure appears temporary. No self-retry detected.",
    requiresUserAction: true,
    policyResult: "APPROVED",
  },
  {
    transactionId: "TX_SEED_002",
    action: "PAYMENT_LINK" as const,
    classification: "TEMPORARY_FAILURE" as const,
    recoverability: "HIGH" as const,
    confidence: 0.85,
    reason: "Timeout error with reliable customer. Payment link recommended.",
    requiresUserAction: true,
    policyResult: "APPROVED",
  },
  {
    transactionId: "TX_SEED_003",
    action: "RETRY" as const,
    classification: "TEMPORARY_FAILURE" as const,
    recoverability: "HIGH" as const,
    confidence: 0.88,
    reason: "Gateway error is temporary. Auto-retry successful.",
    requiresUserAction: false,
    policyResult: "APPROVED",
  },
  {
    transactionId: "TX_SEED_007",
    action: "HUMAN_REVIEW" as const,
    classification: "PAYMENT_METHOD_ISSUE" as const,
    recoverability: "MEDIUM" as const,
    confidence: 0.62,
    reason: "High-value transaction (₹28,500) with bank decline. Requires manual review.",
    requiresUserAction: true,
    policyResult: "ESCALATED",
  },
  {
    transactionId: "TX_SEED_008",
    action: "HUMAN_REVIEW" as const,
    classification: "HIGH_RISK" as const,
    recoverability: "NONE" as const,
    confidence: 0.45,
    reason: "Fraud suspected. Do not attempt automated recovery.",
    requiresUserAction: false,
    policyResult: "ESCALATED",
  },
  {
    transactionId: "TX_SEED_012",
    action: "PAYMENT_LINK" as const,
    classification: "TEMPORARY_FAILURE" as const,
    recoverability: "HIGH" as const,
    confidence: 0.93,
    reason: "Returning customer with excellent payment history.",
    requiresUserAction: true,
    policyResult: "APPROVED",
  },
  {
    transactionId: "TX_SEED_013",
    action: "PAYMENT_LINK" as const,
    classification: "TEMPORARY_FAILURE" as const,
    recoverability: "HIGH" as const,
    confidence: 0.87,
    reason: "Timeout error. Customer likely to pay via new link.",
    requiresUserAction: true,
    policyResult: "APPROVED",
  },
  {
    transactionId: "TX_SEED_015",
    action: "RETRY" as const,
    classification: "TEMPORARY_FAILURE" as const,
    recoverability: "HIGH" as const,
    confidence: 0.90,
    reason: "Gateway issue resolved. Auto-retry succeeded.",
    requiresUserAction: false,
    policyResult: "APPROVED",
  },
];

export async function POST() {
  try {
    // Clear existing data
    await db.delete(auditLogs);
    await db.delete(agentActions);
    await db.delete(recoveryAttempts);
    await db.delete(transactions);
    await db.delete(customers);

    // Seed customers
    for (const customer of SEED_CUSTOMERS) {
      await db.insert(customers).values(customer);
    }

    // Seed transactions
    for (const tx of SEED_TRANSACTIONS) {
      await db.insert(transactions).values({
        id: tx.id,
        customerId: tx.customerId,
        razorpayPaymentId: `pay_seed_${tx.id}`,
        razorpayOrderId: `order_seed_${tx.id}`,
        amount: tx.amount,
        currency: "INR",
        status: tx.status,
        failureReason: tx.failureReason,
        paymentMethod: tx.paymentMethod,
        selfResolved: tx.selfResolved,
        customerRetrying: tx.customerRetrying,
        retryCount: 0,
        createdAt: tx.createdAt,
        updatedAt: tx.createdAt,
      });
    }

    // Seed agent actions
    for (const action of SEED_AGENT_ACTIONS) {
      await db.insert(agentActions).values({
        id: generateId("ACT"),
        ...action,
      });
    }

    // Seed recovery attempts for recovered transactions
    const recoveredIds = ["TX_SEED_001", "TX_SEED_002", "TX_SEED_003", "TX_SEED_012", "TX_SEED_013", "TX_SEED_015"];
    for (const txId of recoveredIds) {
      const tx = SEED_TRANSACTIONS.find((t) => t.id === txId)!;
      const action = SEED_AGENT_ACTIONS.find((a) => a.transactionId === txId)!;
      await db.insert(recoveryAttempts).values({
        id: generateId("REC"),
        transactionId: txId,
        strategy: action.action,
        aiConfidence: action.confidence,
        reason: action.reason,
        status: "SUCCESS",
        amountRecovered: tx.amount,
      });
    }

    // Seed recovery attempts for self-resolved
    const selfResolvedIds = ["TX_SEED_004", "TX_SEED_005", "TX_SEED_006", "TX_SEED_014"];
    for (const txId of selfResolvedIds) {
      await db.insert(recoveryAttempts).values({
        id: generateId("REC"),
        transactionId: txId,
        strategy: "NO_ACTION",
        reason: "Customer self-resolved. System correctly chose not to interfere.",
        status: "SKIPPED",
      });
    }

    // Seed recovery attempts for escalated
    const escalatedIds = ["TX_SEED_007", "TX_SEED_008"];
    for (const txId of escalatedIds) {
      const action = SEED_AGENT_ACTIONS.find((a) => a.transactionId === txId)!;
      await db.insert(recoveryAttempts).values({
        id: generateId("REC"),
        transactionId: txId,
        strategy: "HUMAN_REVIEW",
        aiConfidence: action.confidence,
        reason: action.reason,
        status: "PENDING",
      });
    }

    // Seed audit logs for key events
    for (const tx of SEED_TRANSACTIONS) {
      await db.insert(auditLogs).values({
        id: generateId("LOG"),
        transactionId: tx.id,
        event: "PAYMENT_FAILED",
        metadata: { amount: tx.amount, failureReason: tx.failureReason },
        createdAt: tx.createdAt,
      });

      if (tx.selfResolved) {
        await db.insert(auditLogs).values({
          id: generateId("LOG"),
          transactionId: tx.id,
          event: "CUSTOMER_SELF_RESOLVED",
          metadata: { message: "Customer retried and paid successfully." },
          createdAt: new Date(tx.createdAt.getTime() + 3 * 60 * 1000),
        });
      }

      if (tx.status === "RECOVERED") {
        await db.insert(auditLogs).values({
          id: generateId("LOG"),
          transactionId: tx.id,
          event: "AI_ANALYSIS_COMPLETED",
          metadata: {},
          createdAt: new Date(tx.createdAt.getTime() + 10 * 60 * 1000),
        });
        await db.insert(auditLogs).values({
          id: generateId("LOG"),
          transactionId: tx.id,
          event: "POLICY_APPROVED",
          metadata: {},
          createdAt: new Date(tx.createdAt.getTime() + 10 * 60 * 1000 + 1000),
        });
        await db.insert(auditLogs).values({
          id: generateId("LOG"),
          transactionId: tx.id,
          event: "PAYMENT_RECOVERED",
          metadata: { amountRecovered: tx.amount },
          createdAt: new Date(tx.createdAt.getTime() + 15 * 60 * 1000),
        });
      }

      if (tx.status === "ESCALATED") {
        await db.insert(auditLogs).values({
          id: generateId("LOG"),
          transactionId: tx.id,
          event: "HUMAN_REVIEW_CREATED",
          metadata: {},
          createdAt: new Date(tx.createdAt.getTime() + 10 * 60 * 1000),
        });
      }
    }

    return NextResponse.json({
      status: "success",
      message: "Database seeded with demo data",
      counts: {
        customers: SEED_CUSTOMERS.length,
        transactions: SEED_TRANSACTIONS.length,
        agentActions: SEED_AGENT_ACTIONS.length,
      },
    });
  } catch (error) {
    console.error("Seed error:", error);
    return NextResponse.json(
      {
        error: "Failed to seed database",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
