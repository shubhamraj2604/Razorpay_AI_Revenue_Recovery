import { inngest } from "./client";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { executeRecovery, createAuditLog } from "@/services/recovery-engine";

// ============================================
// INNGEST RECOVERY WORKFLOW
// ============================================

/**
 * Main recovery workflow — triggered after a payment fails.
 * 
 * Flow:
 * 1. Wait for cooldown period (10 minutes)
 * 2. Check if customer self-resolved
 * 3. If not → run full AI recovery pipeline
 */
export const recoveryWorkflow = inngest.createFunction(
  {
    id: "recovery-workflow",
    name: "AI Revenue Recovery Workflow",
    triggers: [{ event: "payment/failed" }],
  },
  async ({ event, step }: { event: { data: { transactionId: string; cooldownMinutes?: number } }; step: any }) => {
    const { transactionId, cooldownMinutes } = event.data;

    // ─── Step 1: Wait for cooldown ───
    await step.sleep("cooldown-wait", `${cooldownMinutes || 10}m`);

    // ─── Step 2: Check if transaction is still failed ───
    const transaction = await step.run("check-transaction-status", async () => {
      const result = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, transactionId))
        .limit(1);

      return result[0] || null;
    });

    if (!transaction) {
      return { status: "error", message: "Transaction not found" };
    }

    // If customer self-resolved during cooldown, we're done
    if (transaction.selfResolved || transaction.status === "SELF_RESOLVED") {
      await step.run("log-self-resolved", async () => {
        await createAuditLog(transactionId, "COOLDOWN_EXPIRED_SELF_RESOLVED", {
          message: "Customer self-resolved during cooldown. No action taken.",
        });
      });

      return {
        status: "self_resolved",
        message: "Customer self-resolved. No intervention needed.",
      };
    }

    // If already recovering or recovered, skip
    if (["RECOVERING", "RECOVERED", "ESCALATED"].includes(transaction.status)) {
      return {
        status: "already_handled",
        message: `Transaction already in status: ${transaction.status}`,
      };
    }

    // ─── Step 3: No self-retry detected → Run AI recovery ───
    await step.run("log-cooldown-expired", async () => {
      await createAuditLog(transactionId, "COOLDOWN_EXPIRED_NO_RETRY", {
        message: "Cooldown expired. No customer self-retry detected. Starting AI recovery.",
      });
    });

    const recoveryResult = await step.run("execute-recovery", async () => {
      return await executeRecovery(transactionId);
    });

    return {
      status: "completed",
      result: recoveryResult,
    };
  }
);

/**
 * Handle payment link paid event — marks recovery as successful
 */
export const paymentLinkPaid = inngest.createFunction(
  {
    id: "payment-link-paid",
    name: "Handle Payment Link Paid",
    triggers: [{ event: "payment-link/paid" }],
  },
  async ({ event, step }: { event: { data: { transactionId: string; paymentId: string; amount: number } }; step: any }) => {
    const { transactionId, paymentId, amount } = event.data;

    await step.run("mark-recovered", async () => {
      // Update transaction
      await db
        .update(transactions)
        .set({
          status: "RECOVERED",
          razorpayPaymentId: paymentId,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transactionId));

      // Update recovery attempt
      const { recoveryAttempts: ra } = await import("@/db/schema");
      const attempts = await db
        .select()
        .from(ra)
        .where(eq(ra.transactionId, transactionId));

      const pendingAttempt = attempts.find((a) => a.status === "PENDING");
      if (pendingAttempt) {
        await db
          .update(ra)
          .set({
            status: "SUCCESS",
            amountRecovered: amount,
          })
          .where(eq(ra.id, pendingAttempt.id));
      }

      await createAuditLog(transactionId, "PAYMENT_RECOVERED", {
        paymentId,
        amountRecovered: amount,
      });
    });

    return { status: "recovered", transactionId };
  }
);

export const inngestFunctions = [recoveryWorkflow, paymentLinkPaid];
