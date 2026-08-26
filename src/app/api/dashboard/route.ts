import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, recoveryAttempts, auditLogs, customers, agentActions } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";

// ============================================
// DASHBOARD DATA API
// ============================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") || "overview";

    switch (view) {
      case "overview":
        return await getOverview();
      case "transactions":
        return await getTransactions();
      case "activity":
        return await getActivity();
      default:
        return NextResponse.json({ error: "Invalid view" }, { status: 400 });
    }
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard data" },
      { status: 500 }
    );
  }
}

/**
 * Overview — KPI metrics
 */
async function getOverview() {
  const allTransactions = await db.select().from(transactions);
  const allRecoveryAttempts = await db.select().from(recoveryAttempts);

  // Revenue at risk (all failed/abandoned/cooldown/recovering/escalated)
  const atRiskStatuses = ["FAILED", "COOLDOWN", "RECOVERING", "RECOVERED", "SELF_RESOLVED", "ESCALATED", "ABANDONED"];
  const atRiskTx = allTransactions.filter((t) => atRiskStatuses.includes(t.status));
  const revenueAtRisk = atRiskTx.reduce((sum, t) => sum + t.amount, 0);

  // Self-resolved
  const selfResolvedTx = allTransactions.filter((t) => t.selfResolved);
  const selfResolvedAmount = selfResolvedTx.reduce((sum, t) => sum + t.amount, 0);

  // Recovered by AI
  const recoveredTx = allTransactions.filter((t) => t.status === "RECOVERED");
  const recoveredAmount = recoveredTx.reduce((sum, t) => sum + t.amount, 0);

  // Recoverable (HIGH/MEDIUM recoverability from agent actions)
  const actions = await db.select().from(agentActions);
  const recoverableActions = actions.filter(
    (a) => a.recoverability === "HIGH" || a.recoverability === "MEDIUM"
  );
  const recoverableTxIds = new Set(recoverableActions.map((a) => a.transactionId));
  const recoverableAmount = allTransactions
    .filter((t) => recoverableTxIds.has(t.id) || t.status === "RECOVERED" || t.selfResolved)
    .reduce((sum, t) => sum + t.amount, 0);

  // Recovery rate
  const totalSaved = recoveredAmount + selfResolvedAmount;
  const recoveryRate = revenueAtRisk > 0 ? (totalSaved / revenueAtRisk) * 100 : 0;

  // Action stats
  const totalActions = allRecoveryAttempts.filter((a) => a.strategy !== "NO_ACTION").length;
  const successfulActions = allRecoveryAttempts.filter((a) => a.status === "SUCCESS").length;
  const humanEscalations = allTransactions.filter((t) => t.status === "ESCALATED").length;

  // Status breakdown
  const statusBreakdown = {
    failed: allTransactions.filter((t) => t.status === "FAILED").length,
    cooldown: allTransactions.filter((t) => t.status === "COOLDOWN").length,
    recovering: allTransactions.filter((t) => t.status === "RECOVERING").length,
    recovered: recoveredTx.length,
    selfResolved: selfResolvedTx.length,
    escalated: humanEscalations,
    abandoned: allTransactions.filter((t) => t.status === "ABANDONED").length,
  };

  return NextResponse.json({
    metrics: {
      revenueAtRisk,
      recoverableAmount,
      selfResolvedAmount,
      recoveredAmount,
      totalSaved,
      recoveryRate: Math.round(recoveryRate * 10) / 10,
      totalTransactions: allTransactions.length,
      totalActions,
      successfulActions,
      humanEscalations,
    },
    statusBreakdown,
  });
}

/**
 * Transactions list with all details
 */
async function getTransactions() {
  const allTransactions = await db
    .select()
    .from(transactions)
    .orderBy(desc(transactions.createdAt));

  // Enrich with customer data and agent actions
  const enrichedTransactions = await Promise.all(
    allTransactions.map(async (tx) => {
      const customer = await db
        .select()
        .from(customers)
        .where(eq(customers.id, tx.customerId))
        .limit(1);

      const action = await db
        .select()
        .from(agentActions)
        .where(eq(agentActions.transactionId, tx.id))
        .limit(1);

      const recovery = await db
        .select()
        .from(recoveryAttempts)
        .where(eq(recoveryAttempts.transactionId, tx.id))
        .orderBy(desc(recoveryAttempts.createdAt))
        .limit(1);

      return {
        ...tx,
        customerName: customer[0]?.name || "Unknown",
        customerEmail: customer[0]?.email || "",
        aiAction: action[0]?.action || null,
        aiConfidence: action[0]?.confidence || null,
        aiClassification: action[0]?.classification || null,
        aiReason: action[0]?.reason || null,
        recoveryStrategy: recovery[0]?.strategy || null,
        recoveryStatus: recovery[0]?.status || null,
        amountRecovered: recovery[0]?.amountRecovered || 0,
      };
    })
  );

  return NextResponse.json({ transactions: enrichedTransactions });
}

/**
 * Activity feed — Recent audit logs
 */
async function getActivity() {
  const logs = await db
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(50);

  // Enrich with transaction data
  const enrichedLogs = await Promise.all(
    logs.map(async (log) => {
      const tx = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, log.transactionId))
        .limit(1);

      const customer = tx[0]
        ? await db
            .select()
            .from(customers)
            .where(eq(customers.id, tx[0].customerId))
            .limit(1)
        : [];

      return {
        ...log,
        amount: tx[0]?.amount || 0,
        customerName: customer[0]?.name || "Unknown",
      };
    })
  );

  return NextResponse.json({ activity: enrichedLogs });
}
