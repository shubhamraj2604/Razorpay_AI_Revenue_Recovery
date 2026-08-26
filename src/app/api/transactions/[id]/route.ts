import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, customers, agentActions, recoveryAttempts, auditLogs } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getCustomerContext } from "@/services/customer-context";

// ============================================
// TRANSACTION DETAIL API
// ============================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get transaction
    const tx = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, id))
      .limit(1);

    if (!tx.length) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    const transaction = tx[0];

    // Get customer
    const customer = await db
      .select()
      .from(customers)
      .where(eq(customers.id, transaction.customerId))
      .limit(1);

    // Get customer context
    const context = await getCustomerContext(transaction.customerId, id);

    // Get AI action
    const action = await db
      .select()
      .from(agentActions)
      .where(eq(agentActions.transactionId, id))
      .orderBy(desc(agentActions.createdAt))
      .limit(1);

    // Get recovery attempts
    const recoveries = await db
      .select()
      .from(recoveryAttempts)
      .where(eq(recoveryAttempts.transactionId, id))
      .orderBy(desc(recoveryAttempts.createdAt));

    // Get audit trail
    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.transactionId, id))
      .orderBy(auditLogs.createdAt);

    return NextResponse.json({
      transaction,
      customer: customer[0] || null,
      customerContext: context,
      aiAction: action[0] || null,
      recoveryAttempts: recoveries,
      auditTrail: logs,
    });
  } catch (error) {
    console.error("Transaction detail error:", error);
    return NextResponse.json(
      { error: "Failed to fetch transaction details" },
      { status: 500 }
    );
  }
}
