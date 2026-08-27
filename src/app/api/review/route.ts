import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, recoveryAttempts, agentActions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import { createAuditLog, executeRecovery, executePaymentLinkRecovery } from "@/services/recovery-engine";

// ============================================
// HUMAN REVIEW API
// ============================================

/**
 * GET — List all transactions pending human review
 */
export async function GET() {
  try {
    const escalated = await db
      .select()
      .from(transactions)
      .where(eq(transactions.status, "ESCALATED"));

    return NextResponse.json({ transactions: escalated });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch review queue" },
      { status: 500 }
    );
  }
}

/**
 * POST — Approve or reject a human review case
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { transactionId, action } = body; // action: "approve" | "reject"

    if (!transactionId || !["approve", "reject"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid request. Need transactionId and action (approve/reject)" },
        { status: 400 }
      );
    }

    const tx = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .limit(1);

    if (!tx.length) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    if (tx[0].status !== "ESCALATED") {
      return NextResponse.json(
        { error: "Transaction is not pending review" },
        { status: 400 }
      );
    }

    if (action === "approve") {
      // Approve → run recovery (bypassing policy for human-approved actions)
      await createAuditLog(transactionId, "HUMAN_REVIEW_APPROVED", {
        message: "Merchant approved recovery action.",
      });

      // Reset status to FAILED so recovery engine can process it
      await db
        .update(transactions)
        .set({ status: "FAILED", updatedAt: new Date() })
        .where(eq(transactions.id, transactionId));

      // Retrieve previous AI decision context to pass to executePaymentLinkRecovery
      const actionRow = await db
        .select()
        .from(agentActions)
        .where(eq(agentActions.transactionId, transactionId))
        .limit(1);
        
      const aiDecision = {
        classification: actionRow[0]?.classification || "UNKNOWN",
        recoverability: actionRow[0]?.recoverability || "MEDIUM",
        confidence: actionRow[0]?.confidence || 1.0,
        recommended_action: "PAYMENT_LINK" as const,
        requires_user_action: true,
        reason: actionRow[0]?.reason || "Manual human override",
      };

      const policyResult = {
        approved: true,
        action: "EXECUTE" as const,
        reason: "Manual human override approved this action.",
        checks: [],
      };

      const result = await executePaymentLinkRecovery(transactionId, tx[0], aiDecision, policyResult);

      return NextResponse.json({
        status: "approved",
        result,
        message: "Recovery approved and executed.",
      });
    } else {
      // Reject → mark as abandoned
      await db
        .update(transactions)
        .set({ status: "ABANDONED", updatedAt: new Date() })
        .where(eq(transactions.id, transactionId));

      await db.insert(recoveryAttempts).values({
        id: generateId("REC"),
        transactionId,
        strategy: "STOP",
        reason: "Human review rejected. Merchant decided not to recover.",
        status: "SKIPPED",
      });

      await createAuditLog(transactionId, "HUMAN_REVIEW_REJECTED", {
        message: "Merchant rejected recovery action.",
      });

      return NextResponse.json({
        status: "rejected",
        message: "Recovery rejected. Transaction marked as abandoned.",
      });
    }
  } catch (error) {
    console.error("Human review error:", error);
    return NextResponse.json(
      { error: "Failed to process review" },
      { status: 500 }
    );
  }
}
