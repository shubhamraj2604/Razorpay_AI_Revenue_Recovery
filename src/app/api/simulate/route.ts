import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { customers, transactions, recoveryAttempts, auditLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateId, getCooldownExpiry, rupeesToPaise } from "@/lib/utils";
import { createAuditLog, executeRecovery } from "@/services/recovery-engine";
import { inngest } from "@/inngest/client";

// ============================================
// SIMULATION ENGINE
// ============================================

// Pre-defined simulation scenarios
const SCENARIOS = {
  // Scenario A: Customer abandons → AI recovers
  abandoned: {
    customer: { name: "Rahul Sharma", email: "rahul@example.com", phone: "+919876543210" },
    amount: 249900, // ₹2,499 in paise
    failureReason: "INSUFFICIENT_FUNDS: Not enough balance in account",
    paymentMethod: "UPI",
    selfRetry: false,
    description: "Customer abandons due to insufficient funds. AI instantly creates payment link.",
  },
  // Scenario B: Customer self-retries → AI stays quiet
  self_retry: {
    customer: { name: "Priya Patel", email: "priya@example.com", phone: "+919876543211" },
    amount: 89900, // ₹899 in paise
    failureReason: "TIMEOUT: Payment request timed out",
    paymentMethod: "CARD",
    selfRetry: true,
    description: "Customer retries on their own. System detects and does nothing.",
  },
  // Scenario C: High-value → Human review
  high_value: {
    customer: { name: "Amit Kumar", email: "amit@example.com", phone: "+919876543212" },
    amount: 2850000, // ₹28,500 in paise
    failureReason: "BANK_DECLINED: Transaction declined by issuing bank",
    paymentMethod: "CARD",
    selfRetry: false,
    description: "High-value transaction. Policy sends to human review.",
  },
  // Scenario D: Low confidence → Human review
  low_confidence: {
    customer: { name: "Sneha Reddy", email: "sneha@example.com", phone: "+919876543213" },
    amount: 120000, // ₹1,200 in paise
    failureReason: "UNKNOWN: Payment could not be processed",
    paymentMethod: "NET_BANKING",
    selfRetry: false,
    description: "Unclear failure reason. AI has low confidence. Human review.",
  },
  // Scenario E: Temporary failure → Auto retry
  auto_retry: {
    customer: { name: "Vikram Singh", email: "vikram@example.com", phone: "+919876543214" },
    amount: 49900, // ₹499 in paise
    failureReason: "GATEWAY_ERROR: Payment gateway temporarily unavailable",
    paymentMethod: "UPI",
    selfRetry: false,
    description: "Temporary gateway issue. System auto-retries successfully.",
  },
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const scenarioKey = body.scenario as keyof typeof SCENARIOS;
    const customScenario = body.custom;

    // Use predefined scenario or custom
    const scenario = customScenario || SCENARIOS[scenarioKey];
    if (!scenario) {
      return NextResponse.json(
        {
          error: "Invalid scenario",
          available: Object.keys(SCENARIOS),
        },
        { status: 400 }
      );
    }

    // ─── Step 1: Create or find customer ───
    const customerId = generateId("CUST");
    const existingCustomer = await db
      .select()
      .from(customers)
      .where(eq(customers.email, scenario.customer.email))
      .limit(1);

    let finalCustomerId = customerId;
    if (existingCustomer.length) {
      finalCustomerId = existingCustomer[0].id;
    } else {
      await db.insert(customers).values({
        id: customerId,
        name: scenario.customer.name,
        email: scenario.customer.email,
        phone: scenario.customer.phone,
      });
    }

    // ─── Step 2: Create failed transaction ───
    const transactionId = generateId("TX");
    const cooldownUntil = getCooldownExpiry(0.1); // 6 seconds for demo (instead of 10 min)

    await db.insert(transactions).values({
      id: transactionId,
      customerId: finalCustomerId,
      razorpayPaymentId: `pay_sim_${generateId("")}`,
      razorpayOrderId: `order_sim_${generateId("")}`,
      amount: scenario.amount,
      currency: "INR",
      status: "COOLDOWN",
      failureReason: scenario.failureReason,
      paymentMethod: scenario.paymentMethod,
      cooldownUntil,
      customerRetrying: false,
      selfResolved: false,
      retryCount: 0,
    });

    await createAuditLog(transactionId, "PAYMENT_FAILED", {
      amount: scenario.amount,
      failureReason: scenario.failureReason,
      paymentMethod: scenario.paymentMethod,
      simulated: true,
    });

    await createAuditLog(transactionId, "COOLDOWN_STARTED", {
      cooldownUntil: cooldownUntil.toISOString(),
      cooldownMinutes: 0.1,
      note: "Shortened cooldown for demo",
    });

    // ─── Step 3: Handle based on scenario type ───
    if (scenario.selfRetry) {
      // Simulate customer self-retry after a brief delay
      // In demo, we resolve immediately
      await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 second delay

      await db
        .update(transactions)
        .set({
          status: "SELF_RESOLVED",
          selfResolved: true,
          customerRetrying: true,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transactionId));

      await createAuditLog(transactionId, "CUSTOMER_RETRY_DETECTED", {
        retryAfterSeconds: 2,
      });

      await createAuditLog(transactionId, "CUSTOMER_SELF_RESOLVED", {
        message: "Customer self-resolved payment. No AI intervention needed.",
      });

      await db.insert(recoveryAttempts).values({
        id: generateId("REC"),
        transactionId,
        strategy: "NO_ACTION",
        aiConfidence: null,
        reason: "Customer self-resolved. System correctly chose not to interfere.",
        status: "SKIPPED",
      });

      return NextResponse.json({
        status: "self_resolved",
        transactionId,
        message: "Customer self-resolved. AI stayed quiet. ✅",
        scenario: scenario.description,
      });
    } else {
      // Wait for shortened cooldown then run AI recovery
      await new Promise((resolve) => setTimeout(resolve, 3000)); // 3 second delay

      // Update status to FAILED (cooldown expired)
      await db
        .update(transactions)
        .set({ status: "FAILED", updatedAt: new Date() })
        .where(eq(transactions.id, transactionId));

      await createAuditLog(transactionId, "COOLDOWN_EXPIRED_NO_RETRY", {
        message: "Cooldown expired. No customer self-retry detected. Starting AI recovery.",
      });

      // Run AI recovery pipeline
      const result = await executeRecovery(transactionId);

      return NextResponse.json({
        status: "recovery_executed",
        transactionId,
        result,
        scenario: scenario.description,
      });
    }
  } catch (error) {
    console.error("Simulation error:", error);
    return NextResponse.json(
      {
        error: "Simulation failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * GET — List available simulation scenarios
 */
export async function GET() {
  return NextResponse.json({
    scenarios: Object.entries(SCENARIOS).map(([key, value]) => ({
      id: key,
      description: value.description,
      customerName: value.customer.name,
      amount: value.amount,
      failureReason: value.failureReason,
      selfRetry: value.selfRetry,
    })),
  });
}
