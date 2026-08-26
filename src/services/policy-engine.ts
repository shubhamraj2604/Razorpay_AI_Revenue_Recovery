import { AIDecision } from "./ai-agent";
import { paiseToRupees } from "@/lib/utils";
import { db } from "@/db";
import { recoveryAttempts } from "@/db/schema";
import { eq, and } from "drizzle-orm";

// ============================================
// POLICY / SAFETY ENGINE
// ============================================

export interface PolicyResult {
  approved: boolean;
  action: "EXECUTE" | "HUMAN_REVIEW" | "STOP";
  reason: string;
  checks: PolicyCheck[];
}

export interface PolicyCheck {
  name: string;
  passed: boolean;
  detail: string;
}

interface PolicyInput {
  transactionId: string;
  amount: number; // in paise
  aiDecision: AIDecision;
  customerRetrying: boolean;
  selfResolved: boolean;
  currentStatus: string;
}

/**
 * Validate AI decision against safety rules.
 * The AI recommends. The policy engine controls. The backend executes.
 */
export async function validatePolicy(input: PolicyInput): Promise<PolicyResult> {
  const checks: PolicyCheck[] = [];
  const maxAmount = parseInt(process.env.MAX_AUTO_RECOVERY_AMOUNT || "10000") * 100; // convert to paise
  const minConfidence = parseFloat(process.env.MIN_AI_CONFIDENCE || "0.70");
  const maxAttempts = parseInt(process.env.MAX_RECOVERY_ATTEMPTS || "2");

  // ─── Check 1: Customer self-retrying ───
  if (input.customerRetrying) {
    checks.push({
      name: "Customer Self-Retry",
      passed: false,
      detail: "Customer is currently self-retrying. Do not interfere.",
    });
    return {
      approved: false,
      action: "STOP",
      reason: "Customer is actively retrying payment. No intervention needed.",
      checks,
    };
  }
  checks.push({
    name: "Customer Self-Retry",
    passed: true,
    detail: "No self-retry detected within cooldown window.",
  });

  // ─── Check 2: Already resolved ───
  if (input.selfResolved || input.currentStatus === "RECOVERED" || input.currentStatus === "SELF_RESOLVED") {
    checks.push({
      name: "Already Resolved",
      passed: false,
      detail: "Transaction already resolved.",
    });
    return {
      approved: false,
      action: "STOP",
      reason: "Transaction already resolved. No action needed.",
      checks,
    };
  }
  checks.push({
    name: "Already Resolved",
    passed: true,
    detail: "Transaction is still unresolved.",
  });

  // ─── Check 3: AI recommends STOP ───
  if (input.aiDecision.recommended_action === "STOP") {
    checks.push({
      name: "AI Recommendation",
      passed: true,
      detail: "AI recommends stopping. Respecting AI decision.",
    });
    return {
      approved: false,
      action: "STOP",
      reason: input.aiDecision.reason,
      checks,
    };
  }
  checks.push({
    name: "AI Recommendation",
    passed: true,
    detail: `AI recommends: ${input.aiDecision.recommended_action}`,
  });

  // ─── Check 4: Amount limit ───
  const amountInRupees = paiseToRupees(input.amount);
  if (input.amount > maxAmount && input.aiDecision.recommended_action !== "HUMAN_REVIEW") {
    checks.push({
      name: "Amount Limit",
      passed: false,
      detail: `₹${amountInRupees.toLocaleString("en-IN")} exceeds auto-action limit of ₹${paiseToRupees(maxAmount).toLocaleString("en-IN")}`,
    });
    return {
      approved: false,
      action: "HUMAN_REVIEW",
      reason: `Amount ₹${amountInRupees.toLocaleString("en-IN")} exceeds the auto-recovery limit. Escalating to human review.`,
      checks,
    };
  }
  checks.push({
    name: "Amount Limit",
    passed: true,
    detail: `₹${amountInRupees.toLocaleString("en-IN")} is within auto-action limit.`,
  });

  // ─── Check 5: AI Confidence ───
  if (input.aiDecision.confidence < minConfidence && input.aiDecision.recommended_action !== "HUMAN_REVIEW") {
    checks.push({
      name: "Confidence Threshold",
      passed: false,
      detail: `AI confidence ${(input.aiDecision.confidence * 100).toFixed(0)}% is below minimum ${(minConfidence * 100).toFixed(0)}%`,
    });
    return {
      approved: false,
      action: "HUMAN_REVIEW",
      reason: `AI confidence (${(input.aiDecision.confidence * 100).toFixed(0)}%) is below the safety threshold. Escalating to human review.`,
      checks,
    };
  }
  checks.push({
    name: "Confidence Threshold",
    passed: true,
    detail: `AI confidence ${(input.aiDecision.confidence * 100).toFixed(0)}% meets threshold.`,
  });

  // ─── Check 6: Recovery attempt limit ───
  const existingAttempts = await db
    .select()
    .from(recoveryAttempts)
    .where(eq(recoveryAttempts.transactionId, input.transactionId));

  const attemptCount = existingAttempts.length;
  if (attemptCount >= maxAttempts) {
    checks.push({
      name: "Attempt Limit",
      passed: false,
      detail: `${attemptCount} attempts already made. Maximum is ${maxAttempts}.`,
    });
    return {
      approved: false,
      action: "STOP",
      reason: `Maximum recovery attempts (${maxAttempts}) reached. Stopping to avoid customer fatigue.`,
      checks,
    };
  }
  checks.push({
    name: "Attempt Limit",
    passed: true,
    detail: `Attempt ${attemptCount + 1} of ${maxAttempts}.`,
  });

  // ─── Check 7: Duplicate recovery check ───
  const activeRecovery = existingAttempts.find((a) => a.status === "PENDING");
  if (activeRecovery) {
    checks.push({
      name: "Duplicate Check",
      passed: false,
      detail: "A recovery action is already in progress.",
    });
    return {
      approved: false,
      action: "STOP",
      reason: "A recovery action is already in progress for this transaction.",
      checks,
    };
  }
  checks.push({
    name: "Duplicate Check",
    passed: true,
    detail: "No active recovery in progress.",
  });

  // ─── All checks passed ───
  if (input.aiDecision.recommended_action === "HUMAN_REVIEW") {
    return {
      approved: false,
      action: "HUMAN_REVIEW",
      reason: input.aiDecision.reason,
      checks,
    };
  }

  return {
    approved: true,
    action: "EXECUTE",
    reason: `All safety checks passed. Proceeding with ${input.aiDecision.recommended_action}.`,
    checks,
  };
}
