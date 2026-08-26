import { db } from "@/db";
import { transactions, recoveryAttempts, auditLogs, agentActions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { razorpay } from "@/lib/razorpay";
import { generateId, paiseToRupees } from "@/lib/utils";
import { getCustomerContext } from "./customer-context";
import { diagnoseTransaction, AIDecision } from "./ai-agent";
import { validatePolicy, PolicyResult } from "./policy-engine";

// ============================================
// RECOVERY ENGINE — Orchestrates the full flow
// ============================================

export interface RecoveryResult {
  transactionId: string;
  aiDecision: AIDecision;
  policyResult: PolicyResult;
  action: string;
  success: boolean;
  paymentLinkUrl?: string;
  message: string;
}

/**
 * Create an audit log entry
 */
export async function createAuditLog(
  transactionId: string,
  event: string,
  metadata?: Record<string, unknown>
) {
  await db.insert(auditLogs).values({
    id: generateId("LOG"),
    transactionId,
    event,
    metadata: metadata || {},
  });
}

/**
 * Execute the full recovery pipeline for a transaction.
 * This runs AFTER the cooldown has expired and no self-retry was detected.
 * 
 * Flow: Fetch Context → AI Diagnosis → Policy Check → Execute Action → Record Result
 */
export async function executeRecovery(transactionId: string): Promise<RecoveryResult> {
  // ─── Step 1: Get the transaction ───
  const txResult = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .limit(1);

  if (!txResult.length) {
    throw new Error(`Transaction ${transactionId} not found`);
  }

  const tx = txResult[0];

  // Don't recover if already resolved
  if (["RECOVERED", "SELF_RESOLVED"].includes(tx.status)) {
    return {
      transactionId,
      aiDecision: {} as AIDecision,
      policyResult: {} as PolicyResult,
      action: "NONE",
      success: false,
      message: "Transaction already resolved.",
    };
  }

  // ─── Step 2: Get customer context ───
  const customerContext = await getCustomerContext(tx.customerId, transactionId);
  if (!customerContext) {
    throw new Error(`Customer ${tx.customerId} not found`);
  }

  await createAuditLog(transactionId, "CUSTOMER_CONTEXT_FETCHED", {
    successRate: customerContext.successRate,
    selfRetryRate: customerContext.selfRetryRate,
    totalPayments: customerContext.totalPayments,
  });

  // ─── Step 3: AI Diagnosis ───
  const aiDecision = await diagnoseTransaction(
    {
      id: tx.id,
      amount: tx.amount,
      failureReason: tx.failureReason,
      paymentMethod: tx.paymentMethod,
      retryCount: tx.retryCount,
    },
    customerContext
  );

  await createAuditLog(transactionId, "AI_ANALYSIS_COMPLETED", {
    classification: aiDecision.classification,
    confidence: aiDecision.confidence,
    recommendedAction: aiDecision.recommended_action,
    reason: aiDecision.reason,
  });

  // Store the AI's decision
  await db.insert(agentActions).values({
    id: generateId("ACT"),
    transactionId,
    action: aiDecision.recommended_action === "PAYMENT_LINK" ? "PAYMENT_LINK" : 
           aiDecision.recommended_action === "RETRY" ? "RETRY" :
           aiDecision.recommended_action === "HUMAN_REVIEW" ? "HUMAN_REVIEW" : "STOP",
    classification: aiDecision.classification,
    recoverability: aiDecision.recoverability,
    reason: aiDecision.reason,
    confidence: aiDecision.confidence,
    requiresUserAction: aiDecision.requires_user_action,
  });

  // ─── Step 4: Policy Validation ───
  const policyResult = await validatePolicy({
    transactionId,
    amount: tx.amount,
    aiDecision,
    customerRetrying: tx.customerRetrying,
    selfResolved: tx.selfResolved,
    currentStatus: tx.status,
  });

  // Update agent action with policy result
  await createAuditLog(transactionId, policyResult.approved ? "POLICY_APPROVED" : "POLICY_REJECTED", {
    action: policyResult.action,
    reason: policyResult.reason,
    checks: policyResult.checks,
  });

  // ─── Step 5: Execute based on policy result ───
  if (policyResult.action === "STOP") {
    await db
      .update(transactions)
      .set({ status: "ABANDONED", updatedAt: new Date() })
      .where(eq(transactions.id, transactionId));

    await db.insert(recoveryAttempts).values({
      id: generateId("REC"),
      transactionId,
      strategy: "STOP",
      aiConfidence: aiDecision.confidence,
      reason: policyResult.reason,
      status: "SKIPPED",
    });

    return {
      transactionId,
      aiDecision,
      policyResult,
      action: "STOP",
      success: false,
      message: policyResult.reason,
    };
  }

  if (policyResult.action === "HUMAN_REVIEW") {
    await db
      .update(transactions)
      .set({ status: "ESCALATED", updatedAt: new Date() })
      .where(eq(transactions.id, transactionId));

    await db.insert(recoveryAttempts).values({
      id: generateId("REC"),
      transactionId,
      strategy: "HUMAN_REVIEW",
      aiConfidence: aiDecision.confidence,
      reason: policyResult.reason,
      status: "PENDING",
    });

    await createAuditLog(transactionId, "HUMAN_REVIEW_CREATED", {
      reason: policyResult.reason,
    });

    return {
      transactionId,
      aiDecision,
      policyResult,
      action: "HUMAN_REVIEW",
      success: false,
      message: "Escalated to human review: " + policyResult.reason,
    };
  }

  // ─── Policy approved — Execute recovery action ───
  if (aiDecision.recommended_action === "PAYMENT_LINK") {
    return await executePaymentLinkRecovery(transactionId, tx, aiDecision, policyResult);
  }

  if (aiDecision.recommended_action === "RETRY") {
    return await executeAutoRetry(transactionId, tx, aiDecision, policyResult);
  }

  // Shouldn't reach here, but handle gracefully
  return {
    transactionId,
    aiDecision,
    policyResult,
    action: "NONE",
    success: false,
    message: "No action taken.",
  };
}

/**
 * Create a Razorpay Payment Link for recovery
 */
async function executePaymentLinkRecovery(
  transactionId: string,
  tx: typeof transactions.$inferSelect,
  aiDecision: AIDecision,
  policyResult: PolicyResult
): Promise<RecoveryResult> {
  try {
    await db
      .update(transactions)
      .set({ status: "RECOVERING", updatedAt: new Date() })
      .where(eq(transactions.id, transactionId));

    // Create Razorpay Payment Link
    const paymentLink = await razorpay.paymentLink.create({
      amount: tx.amount,
      currency: tx.currency,
      description: `Recovery for transaction ${transactionId}`,
      customer: {
        email: "", // Will be filled from customer data
      },
      notify: {
        email: true,
        sms: true,
      },
      callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/recovery/callback?txId=${transactionId}`,
      callback_method: "get",
      notes: {
        transaction_id: transactionId,
        recovery_type: "AI_RECOVERY",
      },
    });

    // Update transaction with payment link
    await db
      .update(transactions)
      .set({
        paymentLinkId: paymentLink.id,
        paymentLinkUrl: paymentLink.short_url,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, transactionId));

    // Record recovery attempt
    await db.insert(recoveryAttempts).values({
      id: generateId("REC"),
      transactionId,
      strategy: "PAYMENT_LINK",
      aiConfidence: aiDecision.confidence,
      reason: aiDecision.reason,
      status: "PENDING",
    });

    await createAuditLog(transactionId, "PAYMENT_LINK_CREATED", {
      paymentLinkId: paymentLink.id,
      paymentLinkUrl: paymentLink.short_url,
      amount: tx.amount,
    });

    return {
      transactionId,
      aiDecision,
      policyResult,
      action: "PAYMENT_LINK",
      success: true,
      paymentLinkUrl: paymentLink.short_url,
      message: `Payment link created: ${paymentLink.short_url}`,
    };
  } catch (error) {
    console.error("Payment link creation failed:", error);

    await createAuditLog(transactionId, "PAYMENT_LINK_FAILED", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    // Escalate to human review on failure
    await db
      .update(transactions)
      .set({ status: "ESCALATED", updatedAt: new Date() })
      .where(eq(transactions.id, transactionId));

    return {
      transactionId,
      aiDecision,
      policyResult,
      action: "PAYMENT_LINK",
      success: false,
      message: "Payment link creation failed. Escalated to human review.",
    };
  }
}

/**
 * Auto-retry payment (simulated for hackathon — real retry would use Razorpay retry API)
 */
async function executeAutoRetry(
  transactionId: string,
  tx: typeof transactions.$inferSelect,
  aiDecision: AIDecision,
  policyResult: PolicyResult
): Promise<RecoveryResult> {
  await db
    .update(transactions)
    .set({
      status: "RECOVERING",
      retryCount: tx.retryCount + 1,
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, transactionId));

  // For the hackathon simulation, auto-retry has a success probability based on AI confidence
  const retrySuccessful = Math.random() < aiDecision.confidence;

  if (retrySuccessful) {
    await db
      .update(transactions)
      .set({ status: "RECOVERED", updatedAt: new Date() })
      .where(eq(transactions.id, transactionId));

    await db.insert(recoveryAttempts).values({
      id: generateId("REC"),
      transactionId,
      strategy: "RETRY",
      aiConfidence: aiDecision.confidence,
      reason: aiDecision.reason,
      status: "SUCCESS",
      amountRecovered: tx.amount,
    });

    await createAuditLog(transactionId, "AUTO_RETRY_SUCCESS", {
      amountRecovered: tx.amount,
    });

    return {
      transactionId,
      aiDecision,
      policyResult,
      action: "RETRY",
      success: true,
      message: `Auto-retry successful. ₹${paiseToRupees(tx.amount).toLocaleString("en-IN")} recovered.`,
    };
  } else {
    await db.insert(recoveryAttempts).values({
      id: generateId("REC"),
      transactionId,
      strategy: "RETRY",
      aiConfidence: aiDecision.confidence,
      reason: aiDecision.reason,
      status: "FAILED",
    });

    await db
      .update(transactions)
      .set({ status: "FAILED", updatedAt: new Date() })
      .where(eq(transactions.id, transactionId));

    await createAuditLog(transactionId, "AUTO_RETRY_FAILED", {});

    return {
      transactionId,
      aiDecision,
      policyResult,
      action: "RETRY",
      success: false,
      message: "Auto-retry failed. May attempt payment link next.",
    };
  }
}
