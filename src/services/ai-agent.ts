import { GoogleGenerativeAI } from "@google/generative-ai";
import { CustomerContext } from "./customer-context";
import { paiseToRupees } from "@/lib/utils";

// ============================================
// AI AGENT — Diagnosis & Decision
// ============================================

export interface AIDecision {
  classification:
    | "TEMPORARY_FAILURE"
    | "PAYMENT_METHOD_ISSUE"
    | "CUSTOMER_ABANDONMENT"
    | "HIGH_RISK"
    | "UNKNOWN";
  recoverability: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  confidence: number;
  recommended_action: "RETRY" | "PAYMENT_LINK" | "HUMAN_REVIEW" | "STOP";
  requires_user_action: boolean;
  reason: string;
}

interface TransactionForAI {
  id: string;
  amount: number; // in paise
  failureReason: string | null;
  paymentMethod: string | null;
  retryCount: number;
}

const SYSTEM_PROMPT = `You are an AI Revenue Recovery Agent for an Indian payment platform.

Your job is to analyze a failed payment transaction along with the customer's history, 
and decide the best recovery strategy.

IMPORTANT RULES:
1. You must return ONLY valid JSON, no markdown, no explanation outside the JSON.
2. Be conservative — when in doubt, recommend HUMAN_REVIEW.
3. Never recommend RETRY for fraud-related failures.
4. Consider customer history — a loyal customer with high success rate is more likely to pay.
5. If the customer has NOT self-retried within the cooldown window, they likely need a nudge.
6. For temporary failures (network, timeout), the payment is very likely recoverable.
7. For payment method issues (card expired, insufficient funds), the customer needs to act.

CLASSIFICATION OPTIONS:
- TEMPORARY_FAILURE: Network errors, timeouts, bank server issues — usually auto-recoverable
- PAYMENT_METHOD_ISSUE: Card expired, insufficient funds — customer needs to update/change method
- CUSTOMER_ABANDONMENT: Customer cancelled or left — needs a nudge to come back
- HIGH_RISK: Fraud suspected, suspicious patterns — do NOT attempt recovery
- UNKNOWN: Cannot determine — be conservative

ACTION OPTIONS:
- RETRY: System retries payment automatically (only for temporary failures, no user action needed)
- PAYMENT_LINK: Create a new payment link for the customer (requires user action)
- HUMAN_REVIEW: Send to merchant for manual review (for risky or uncertain cases)
- STOP: Do not attempt recovery (for fraud or unrecoverable cases)

CONFIDENCE: A number between 0.0 and 1.0 representing your confidence in the recovery.

Return this exact JSON structure:
{
  "classification": "TEMPORARY_FAILURE",
  "recoverability": "HIGH",
  "confidence": 0.91,
  "recommended_action": "PAYMENT_LINK",
  "requires_user_action": true,
  "reason": "Brief explanation of your decision"
}`;

/**
 * Masks Personally Identifiable Information (PII) before sending to LLM.
 * Replaces names with initials, or simply returns [REDACTED].
 */
function maskPII(text: string | null): string {
  if (!text) return "Unknown";
  // Just show first initial for safety
  return text.charAt(0) + "*** [REDACTED]";
}

/**
 * Run AI diagnosis on a failed transaction.
 * Returns a structured decision with classification, confidence, and recommended action.
 */
export async function diagnoseTransaction(
  transaction: TransactionForAI,
  customerContext: CustomerContext
): Promise<AIDecision> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: "gemini-3.6-flash",
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1, // Low temperature for consistent, reliable decisions
    },
  });

  const prompt = `Analyze this failed payment and decide on recovery strategy.

FAILED TRANSACTION:
- Transaction ID: ${transaction.id}
- Amount: ₹${paiseToRupees(transaction.amount).toLocaleString("en-IN")}
- Failure Reason: ${transaction.failureReason || "Unknown"}
- Payment Method: ${transaction.paymentMethod || "Unknown"}
- Previous Retry Attempts: ${transaction.retryCount}

CUSTOMER CONTEXT:
- Name: ${maskPII(customerContext.name)}
- Total Payments: ${customerContext.totalPayments}
- Successful Payments: ${customerContext.successfulPayments}
- Success Rate: ${(customerContext.successRate * 100).toFixed(1)}%
- Self-Retry Rate: ${(customerContext.selfRetryRate * 100).toFixed(1)}%
- Average Order Value: ₹${paiseToRupees(customerContext.averageOrderValue).toLocaleString("en-IN")}
- Previous Recoveries: ${customerContext.totalRecoveries}
- Last Payment: ${customerContext.lastPaymentDaysAgo !== null ? `${customerContext.lastPaymentDaysAgo} days ago` : "First transaction"}
- Currently Self-Retrying: ${customerContext.hasRetriedCurrentPayment ? "YES" : "NO (customer has NOT retried within cooldown period)"}

Based on this data, return your decision as JSON.`;

  try {
    const result = await model.generateContent([SYSTEM_PROMPT, prompt]);
    const responseText = result.response.text();

    // Parse JSON response
    const decision: AIDecision = JSON.parse(responseText);

    // Validate and clamp confidence
    decision.confidence = Math.max(0, Math.min(1, decision.confidence));

    // Safety: never recommend RETRY for high-risk
    if (decision.classification === "HIGH_RISK") {
      decision.recommended_action = "STOP";
      decision.recoverability = "NONE";
      decision.requires_user_action = false;
    }

    return decision;
  } catch (error) {
    console.error("AI diagnosis failed:", error);

    // Fallback: when AI fails, always send to human review
    return {
      classification: "UNKNOWN",
      recoverability: "LOW",
      confidence: 0,
      recommended_action: "HUMAN_REVIEW",
      requires_user_action: false,
      reason:
        "AI analysis failed. Defaulting to human review for safety. Error: " +
        (error instanceof Error ? error.message : "Unknown error"),
    };
  }
}
