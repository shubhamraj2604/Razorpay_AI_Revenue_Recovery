"use client";

import { useState, useEffect, useCallback } from "react";
import {
  LayoutDashboard,
  Activity,
  ShieldCheck,
  Zap,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Eye,
  ArrowRight,
  RefreshCw,
  Play,
  Clock,
  Ban,
  User,
  IndianRupee,
  Brain,
  Shield,
  FileText,
  BarChart3,
} from "lucide-react";
import {
  StatusPieChart,
  StrategyBarChart,
  FailureReasonChart,
  RecoveryFunnel,
  ConfidenceDistribution,
} from "@/components/charts";

// ============================================
// TYPES
// ============================================

interface Metrics {
  revenueAtRisk: number;
  recoverableAmount: number;
  selfResolvedAmount: number;
  recoveredAmount: number;
  totalSaved: number;
  recoveryRate: number;
  totalTransactions: number;
  totalActions: number;
  successfulActions: number;
  humanEscalations: number;
}

interface Transaction {
  id: string;
  customerId: string;
  amount: number;
  status: string;
  failureReason: string | null;
  paymentMethod: string | null;
  selfResolved: boolean;
  customerRetrying: boolean;
  createdAt: string;
  customerName: string;
  aiAction: string | null;
  aiConfidence: number | null;
  aiClassification: string | null;
  aiReason: string | null;
  recoveryStrategy: string | null;
  amountRecovered: number;
}

interface ActivityItem {
  id: string;
  transactionId: string;
  event: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  amount: number;
  customerName: string;
}

interface StatusBreakdown {
  recovered: number;
  selfResolved: number;
  escalated: number;
  failed: number;
  abandoned: number;
  cooldown: number;
  recovering: number;
}

type Tab = "overview" | "review" | "activity" | "analytics";

// ============================================
// HELPERS
// ============================================

function formatCurrency(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 100000) return `₹${(rupees / 100000).toFixed(1)}L`;
  if (rupees >= 1000) return `₹${rupees.toLocaleString("en-IN")}`;
  return `₹${rupees}`;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getEventIcon(event: string): string {
  const map: Record<string, string> = {
    PAYMENT_FAILED: "❌",
    COOLDOWN_STARTED: "⏱️",
    CUSTOMER_RETRY_DETECTED: "🔄",
    CUSTOMER_SELF_RESOLVED: "✅",
    COOLDOWN_EXPIRED_NO_RETRY: "👀",
    COOLDOWN_EXPIRED_SELF_RESOLVED: "🧠",
    AI_ANALYSIS_COMPLETED: "🤖",
    POLICY_APPROVED: "✅",
    POLICY_REJECTED: "🛑",
    PAYMENT_LINK_CREATED: "🔗",
    AUTO_RETRY_SUCCESS: "⚡",
    AUTO_RETRY_FAILED: "❌",
    PAYMENT_RECOVERED: "💰",
    HUMAN_REVIEW_CREATED: "👤",
    HUMAN_REVIEW_APPROVED: "✅",
    HUMAN_REVIEW_REJECTED: "🛑",
    CUSTOMER_CONTEXT_FETCHED: "📋",
  };
  return map[event] || "📌";
}

function getEventClass(event: string): string {
  if (event.includes("FAILED") || event.includes("REJECTED")) return "failed";
  if (event.includes("RECOVERED") || event.includes("APPROVED") || event.includes("SUCCESS") || event.includes("SELF_RESOLVED")) return "recovered";
  if (event.includes("AI") || event.includes("CONTEXT")) return "ai";
  if (event.includes("POLICY")) return "policy";
  if (event.includes("COOLDOWN")) return "cooldown";
  if (event.includes("HUMAN") || event.includes("ESCALATED")) return "escalated";
  return "info";
}

function formatEvent(event: string): string {
  return event
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ============================================
// MAIN DASHBOARD
// ============================================

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<string | null>(null);
  const [selectedTx, setSelectedTx] = useState<string | null>(null);
  const [txDetail, setTxDetail] = useState<Record<string, unknown> | null>(null);
  const [statusBreakdown, setStatusBreakdown] = useState<StatusBreakdown | null>(null);
  const [benchmarkResult, setBenchmarkResult] = useState<any>(null);
  const [runningBenchmark, setRunningBenchmark] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [overviewRes, txRes, activityRes] = await Promise.all([
        fetch("/api/dashboard?view=overview"),
        fetch("/api/dashboard?view=transactions"),
        fetch("/api/dashboard?view=activity"),
      ]);

      const overviewData = await overviewRes.json();
      const txData = await txRes.json();
      const activityData = await activityRes.json();

      setMetrics(overviewData.metrics);
      setStatusBreakdown(overviewData.statusBreakdown || null);
      setTxns(txData.transactions || []);
      setActivity(activityData.activity || []);
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Load benchmark result from localStorage if it exists
    const savedBenchmark = localStorage.getItem("benchmarkResult");
    if (savedBenchmark) {
      try {
        setBenchmarkResult(JSON.parse(savedBenchmark));
      } catch (e) {}
    }
  }, [fetchData]);

  const runSimulation = async (scenario: string) => {
    setSimulating(scenario);
    setSimResult(null);

    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario }),
      });

      const data = await res.json();
      setSimResult(data.message || data.status);

      // Refresh dashboard data
      await fetchData();
    } catch (error) {
      setSimResult("Simulation failed. Check console.");
    } finally {
      setSimulating(null);
    }
  };

  const handleReview = async (transactionId: string, action: "approve" | "reject") => {
    try {
      await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId, action }),
      });
      await fetchData();
      if (selectedTx === transactionId) {
        await fetchTransactionDetail(transactionId);
      }
    } catch (error) {
      console.error("Review action failed:", error);
    }
  };

  const seedDatabase = async () => {
    setLoading(true);
    try {
      await fetch("/api/seed", { method: "POST" });
      await fetchData();
      setBenchmarkResult(null); // Clear benchmark on seed
      localStorage.removeItem("benchmarkResult");
    } catch (error) {
      console.error("Seed failed:", error);
    }
  };

  const runBenchmark = async () => {
    setRunningBenchmark(true);
    setBenchmarkResult(null);
    try {
      const res = await fetch("/api/benchmark", { method: "POST" });
      const data = await res.json();
      if (data.benchmark) {
        setBenchmarkResult(data.benchmark);
        localStorage.setItem("benchmarkResult", JSON.stringify(data.benchmark));
        await fetchData(); // Refresh dashboard with the 1000 txns
      }
    } catch (error) {
      console.error("Benchmark failed:", error);
    } finally {
      setRunningBenchmark(false);
    }
  };

  const fetchTransactionDetail = async (txId: string) => {
    try {
      const res = await fetch(`/api/transactions/${txId}`);
      const data = await res.json();
      setTxDetail(data);
      setSelectedTx(txId);
    } catch (error) {
      console.error("Failed to fetch transaction detail:", error);
    }
  };

  // ─── RENDER ───

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">R</div>
          <div className="sidebar-logo-text">
            <div className="sidebar-logo-title">Revenue Recovery</div>
            <div className="sidebar-logo-subtitle">AI Agent</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`sidebar-nav-item ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => { setActiveTab("overview"); setSelectedTx(null); }}
          >
            <LayoutDashboard size={20} className="sidebar-nav-icon" />
            <span>Dashboard</span>
          </button>
          <button
            className={`sidebar-nav-item ${activeTab === "review" ? "active" : ""}`}
            onClick={() => { setActiveTab("review"); setSelectedTx(null); }}
          >
            <ShieldCheck size={20} className="sidebar-nav-icon" />
            <span>Human Review</span>
          </button>
          <button
            className={`sidebar-nav-item ${activeTab === "analytics" ? "active" : ""}`}
            onClick={() => { setActiveTab("analytics"); setSelectedTx(null); }}
          >
            <BarChart3 size={20} className="sidebar-nav-icon" />
            <span>Analytics</span>
          </button>
          <button
            className={`sidebar-nav-item ${activeTab === "activity" ? "active" : ""}`}
            onClick={() => { setActiveTab("activity"); setSelectedTx(null); }}
          >
            <Activity size={20} className="sidebar-nav-icon" />
            <span>Activity Feed</span>
          </button>
        </nav>

        <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "16px" }}>
          <button className="btn btn-ghost" style={{ width: "100%" }} onClick={seedDatabase}>
            <RefreshCw size={14} />
            <span>Seed Demo Data</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {selectedTx && txDetail ? (
          <TransactionDetail
            data={txDetail}
            onBack={() => { setSelectedTx(null); setTxDetail(null); }}
            onReview={handleReview}
          />
        ) : activeTab === "overview" ? (
          <OverviewTab
            metrics={metrics}
            statusBreakdown={statusBreakdown}
            transactions={txns}
            loading={loading}
            simulating={simulating}
            simResult={simResult}
            onSimulate={runSimulation}
            onSelectTx={fetchTransactionDetail}
            onRefresh={fetchData}
          />
        ) : activeTab === "review" ? (
          <ReviewTab
            transactions={txns.filter((t) => t.status === "ESCALATED")}
            onReview={handleReview}
            onSelectTx={fetchTransactionDetail}
          />
        ) : activeTab === "analytics" ? (
          <AnalyticsTab
            metrics={metrics}
            statusBreakdown={statusBreakdown}
            transactions={txns}
            benchmarkResult={benchmarkResult}
            runningBenchmark={runningBenchmark}
            onRunBenchmark={runBenchmark}
          />
        ) : (
          <ActivityTab activity={activity} />
        )}
      </main>

      {/* Toast */}
      {simResult && (
        <div className="toast-container">
          <div className={`toast ${simResult.includes("✅") || simResult.includes("recovered") ? "success" : "info"}`}>
            {simResult}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// OVERVIEW TAB
// ============================================

function OverviewTab({
  metrics,
  statusBreakdown,
  transactions,
  loading,
  simulating,
  simResult,
  onSimulate,
  onSelectTx,
  onRefresh,
}: {
  metrics: Metrics | null;
  statusBreakdown: StatusBreakdown | null;
  transactions: Transaction[];
  loading: boolean;
  simulating: string | null;
  simResult: string | null;
  onSimulate: (scenario: string) => void;
  onSelectTx: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="page-title">AI Revenue Recovery</h1>
          <p className="page-subtitle">Monitor, recover, and track revenue at risk in real-time</p>
        </div>
        <button className="btn btn-ghost" onClick={onRefresh}>
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* KPI Cards */}
      {loading || !metrics ? (
        <div className="kpi-grid">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="kpi-card">
              <div className="loading-shimmer" style={{ width: "80px", height: "14px", marginBottom: "12px" }} />
              <div className="loading-shimmer" style={{ width: "120px", height: "32px" }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="kpi-grid">
          <div className="kpi-card risk animate-in animate-delay-1">
            <div className="kpi-label">Revenue At Risk</div>
            <div className="kpi-value">{formatCurrency(metrics.revenueAtRisk)}</div>
            <div className="kpi-change">{metrics.totalTransactions} transactions</div>
          </div>
          <div className="kpi-card recoverable animate-in animate-delay-2">
            <div className="kpi-label">Recoverable</div>
            <div className="kpi-value">{formatCurrency(metrics.recoverableAmount)}</div>
            <div className="kpi-change">AI identified</div>
          </div>
          <div className="kpi-card self-resolved animate-in animate-delay-3">
            <div className="kpi-label">Self-Resolved</div>
            <div className="kpi-value">{formatCurrency(metrics.selfResolvedAmount)}</div>
            <div className="kpi-change">No intervention needed</div>
          </div>
          <div className="kpi-card recovered animate-in animate-delay-4">
            <div className="kpi-label">Recovered (AI)</div>
            <div className="kpi-value">{formatCurrency(metrics.recoveredAmount)}</div>
            <div className="kpi-change">{metrics.successfulActions} actions taken</div>
          </div>
          <div className="kpi-card rate animate-in animate-delay-5">
            <div className="kpi-label">Recovery Rate</div>
            <div className="kpi-value">{metrics.recoveryRate}%</div>
            <div className="kpi-change">{metrics.humanEscalations} escalated</div>
          </div>
        </div>
      )}

      {/* Simulation Panel */}
      <div className="sim-panel animate-in">
        <div className="sim-title">
          <Zap size={18} style={{ color: "var(--accent-yellow)" }} />
          Simulate Recovery Scenarios
        </div>
        <div className="sim-grid">
          {[
            { key: "abandoned", title: "Customer Abandons", desc: "AI detects and sends payment link", amount: "₹2,499", icon: "🔗" },
            { key: "self_retry", title: "Customer Self-Retries", desc: "AI stays quiet — no intervention", amount: "₹899", icon: "🧠" },
            { key: "high_value", title: "High-Value Payment", desc: "Policy blocks → human review", amount: "₹28,500", icon: "👤" },
            { key: "auto_retry", title: "Auto Retry", desc: "System retries automatically", amount: "₹499", icon: "⚡" },
            { key: "low_confidence", title: "Low AI Confidence", desc: "Uncertain → sent to human review", amount: "₹1,200", icon: "🤔" },
          ].map((s) => (
            <button
              key={s.key}
              className="sim-button"
              onClick={() => onSimulate(s.key)}
              disabled={!!simulating}
            >
              <div className="sim-button-title">
                {s.icon} {s.title}
              </div>
              <div className="sim-button-desc">{s.desc}</div>
              <div className="sim-button-amount">
                {simulating === s.key ? (
                  <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span className="loading-spinner" /> Running...
                  </span>
                ) : (
                  s.amount
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Transactions Table */}
      <div className="section-card animate-in">
        <div className="section-header">
          <h2 className="section-title">Recent Transactions</h2>
          <span className="section-badge" style={{ background: "var(--accent-blue-dim)", color: "var(--accent-blue-light)" }}>
            {transactions.length} total
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tx-table">
            <thead>
              <tr>
                <th>Transaction</th>
                <th>Customer</th>
                <th>Amount</th>
                <th>Failure</th>
                <th>Self-Retry</th>
                <th>AI Decision</th>
                <th>Confidence</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
                    No transactions yet. Click &quot;Seed Demo Data&quot; or run a simulation.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} onClick={() => onSelectTx(tx.id)}>
                    <td><span className="tx-id">{tx.id}</span></td>
                    <td>{tx.customerName}</td>
                    <td><span className="tx-amount">{formatCurrency(tx.amount)}</span></td>
                    <td style={{ maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {tx.failureReason?.split(":")[0] || "—"}
                    </td>
                    <td>
                      {tx.selfResolved ? (
                        <span style={{ color: "var(--accent-cyan)" }}>✅ Yes</span>
                      ) : tx.customerRetrying ? (
                        <span style={{ color: "var(--accent-yellow)" }}>🔄 Retrying</span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>❌ No</span>
                      )}
                    </td>
                    <td>
                      {tx.aiAction ? (
                        <span style={{ color: "var(--accent-purple)", fontWeight: 600, fontSize: "12px" }}>
                          {tx.aiAction.replace("_", " ")}
                        </span>
                      ) : tx.selfResolved ? (
                        <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>NO ACTION</span>
                      ) : (
                        <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>—</span>
                      )}
                    </td>
                    <td>
                      {tx.aiConfidence ? (
                        <div className="confidence-bar-container">
                          <div className="confidence-bar">
                            <div
                              className={`confidence-bar-fill ${tx.aiConfidence >= 0.8 ? "high" : tx.aiConfidence >= 0.6 ? "medium" : "low"}`}
                              style={{ width: `${tx.aiConfidence * 100}%` }}
                            />
                          </div>
                          <span className="confidence-text">{(tx.aiConfidence * 100).toFixed(0)}%</span>
                        </div>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      )}
                    </td>
                    <td>
                      <span className={`status-badge ${tx.status.toLowerCase().replace("_", "-")}`}>
                        {tx.status.replace("_", " ")}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Charts Row */}
      {metrics && statusBreakdown && (
        <div className="grid-2">
          <RecoveryFunnel metrics={metrics} />
          <StatusPieChart statusBreakdown={statusBreakdown} />
        </div>
      )}
    </>
  );
}

// ============================================
// ANALYTICS TAB
// ============================================

function AnalyticsTab({
  metrics,
  statusBreakdown,
  transactions,
  benchmarkResult,
  runningBenchmark,
  onRunBenchmark,
}: {
  metrics: Metrics | null;
  statusBreakdown: StatusBreakdown | null;
  transactions: Transaction[];
  benchmarkResult: any;
  runningBenchmark: boolean;
  onRunBenchmark: () => void;
}) {
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Analytics</h1>
        <p className="page-subtitle">Deep dive into recovery performance and AI decisions</p>
      </div>

      {metrics && <RecoveryFunnel metrics={metrics} />}

      <div className="grid-2">
        {statusBreakdown && <StatusPieChart statusBreakdown={statusBreakdown} />}
        <StrategyBarChart transactions={transactions} />
      </div>

      <div className="grid-2">
        <FailureReasonChart transactions={transactions} />
        <ConfidenceDistribution transactions={transactions} />
      </div>

      <div className="section-card animate-in" style={{ marginTop: "24px" }}>
        <div className="section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 className="section-title">Benchmark Engine: Baseline vs. AI</h2>
            <p className="page-subtitle" style={{ margin: "4px 0 0 0" }}>Simulate 1,000 transactions to prove AI ROI.</p>
          </div>
          <button
            className="btn btn-primary"
            onClick={onRunBenchmark}
            disabled={runningBenchmark}
          >
            {runningBenchmark ? (
              <RefreshCw size={16} className="spin" />
            ) : (
              <Zap size={16} />
            )}
            <span>{runningBenchmark ? "Running 1,000 Txns..." : "Run Benchmark"}</span>
          </button>
        </div>

        {benchmarkResult ? (
          <div style={{ padding: "24px" }}>
            <div style={{ display: "flex", gap: "24px", marginBottom: "24px" }}>

              {/* Baseline Card */}
              <div style={{ flex: 1, background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: "12px", padding: "20px" }}>
                <h3 style={{ color: "#ef4444", display: "flex", alignItems: "center", gap: "8px", margin: "0 0 16px 0" }}>
                  <Ban size={18} /> Dumb Rules Baseline
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>Total Interventions</span>
                    <span style={{ fontWeight: 600 }}>{benchmarkResult.baseline.actionsTaken.toLocaleString()}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>Spam Actions (Unnecessary)</span>
                    <span style={{ fontWeight: 600, color: "#ef4444" }}>{benchmarkResult.baseline.spamSent.toLocaleString()}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>Human Escalations</span>
                    <span style={{ fontWeight: 600 }}>0 (Unsafe)</span>
                  </div>
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "4px 0" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "16px" }}>
                    <span style={{ color: "var(--text-muted)" }}>Revenue Recovered</span>
                    <span style={{ fontWeight: 700 }}>₹{(benchmarkResult.baseline.amountRecovered / 100).toLocaleString("en-IN")}</span>
                  </div>
                </div>
              </div>

              {/* AI Agent Card */}
              <div style={{ flex: 1, background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.2)", borderRadius: "12px", padding: "20px" }}>
                <h3 style={{ color: "#10b981", display: "flex", alignItems: "center", gap: "8px", margin: "0 0 16px 0" }}>
                  <Brain size={18} /> AI Agent
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>Smart Interventions</span>
                    <span style={{ fontWeight: 600, color: "#10b981" }}>{benchmarkResult.ai.actionsTaken.toLocaleString()}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>Spam Actions (Unnecessary)</span>
                    <span style={{ fontWeight: 600, color: "#10b981" }}>0</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>Human Escalations</span>
                    <span style={{ fontWeight: 600, color: "#f59e0b" }}>{benchmarkResult.ai.humanEscalations.toLocaleString()} (Safe)</span>
                  </div>
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "4px 0" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "16px" }}>
                    <span style={{ color: "var(--text-muted)" }}>Total Saved (AI + Self)</span>
                    <span style={{ fontWeight: 700, color: "#10b981" }}>₹{(benchmarkResult.ai.totalSaved / 100).toLocaleString("en-IN")}</span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        ) : (
          <div style={{ padding: "60px", textAlign: "center", borderTop: "1px solid var(--border-color)" }}>
            <Zap size={48} style={{ color: "var(--text-muted)", marginBottom: "16px", opacity: 0.5 }} />
            <h3 style={{ marginBottom: "8px" }}>Prove Your ROI</h3>
            <p style={{ color: "var(--text-muted)", maxWidth: "400px", margin: "0 auto" }}>
              Run the benchmark engine to simulate 1,000 transactions and generate the mathematical proof that our AI Agent outperforms standard rule-based recovery systems.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

// ============================================
// REVIEW TAB
// ============================================

function ReviewTab({
  transactions,
  onReview,
  onSelectTx,
}: {
  transactions: Transaction[];
  onReview: (id: string, action: "approve" | "reject") => void;
  onSelectTx: (id: string) => void;
}) {
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Human Review Queue</h1>
        <p className="page-subtitle">Review escalated transactions that need merchant approval</p>
      </div>

      {transactions.length === 0 ? (
        <div className="section-card" style={{ padding: "60px", textAlign: "center" }}>
          <ShieldCheck size={48} style={{ color: "var(--accent-green)", marginBottom: "16px" }} />
          <h3 style={{ marginBottom: "8px" }}>All Clear</h3>
          <p style={{ color: "var(--text-muted)" }}>No transactions pending review.</p>
        </div>
      ) : (
        transactions.map((tx) => (
          <div key={tx.id} className="review-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
              <div>
                <span className="tx-id" style={{ fontSize: "14px" }}>{tx.id}</span>
                <h3 style={{ fontSize: "24px", fontWeight: 800, marginTop: "4px" }}>
                  {formatCurrency(tx.amount)}
                </h3>
              </div>
              <span className="status-badge escalated">
                <AlertTriangle size={12} /> Pending Review
              </span>
            </div>

            <div className="detail-grid" style={{ padding: 0, marginBottom: "16px" }}>
              <div className="detail-item">
                <span className="detail-label">Customer</span>
                <span className="detail-value">{tx.customerName}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Failure Reason</span>
                <span className="detail-value">{tx.failureReason || "Unknown"}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">AI Confidence</span>
                <span className="detail-value" style={{ color: "var(--accent-yellow)" }}>
                  {tx.aiConfidence ? `${(tx.aiConfidence * 100).toFixed(0)}%` : "N/A"}
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">AI Reason</span>
                <span className="detail-value">{tx.aiReason || "—"}</span>
              </div>
            </div>

            <div className="review-actions">
              <button className="btn btn-success" onClick={() => onReview(tx.id, "approve")}>
                <CheckCircle2 size={14} /> Approve Recovery
              </button>
              <button className="btn btn-danger" onClick={() => onReview(tx.id, "reject")}>
                <Ban size={14} /> Reject
              </button>
              <button className="btn btn-ghost" onClick={() => onSelectTx(tx.id)}>
                <Eye size={14} /> View Details
              </button>
            </div>
          </div>
        ))
      )}
    </>
  );
}

// ============================================
// ACTIVITY TAB
// ============================================

function ActivityTab({ activity }: { activity: ActivityItem[] }) {
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Agent Activity</h1>
        <p className="page-subtitle">Real-time feed of all AI agent decisions and actions</p>
      </div>

      <div className="section-card">
        <ul className="activity-list">
          {activity.length === 0 ? (
            <li className="activity-item" style={{ justifyContent: "center", padding: "40px" }}>
              <span style={{ color: "var(--text-muted)" }}>No activity yet.</span>
            </li>
          ) : (
            activity.map((item) => (
              <li key={item.id} className="activity-item">
                <div className={`activity-icon ${getEventClass(item.event)}`}>
                  {getEventIcon(item.event)}
                </div>
                <div className="activity-content">
                  <div className="activity-text">
                    <strong>{formatEvent(item.event)}</strong>
                    {" — "}
                    <span className="tx-id">{item.transactionId}</span>
                    {item.customerName && item.customerName !== "Unknown" && (
                      <span> ({item.customerName})</span>
                    )}
                    {item.amount > 0 && item.event.includes("RECOVERED") && (
                      <span className="activity-amount"> {formatCurrency(item.amount)} recovered</span>
                    )}
                  </div>
                  <div className="activity-time">
                    {formatDate(item.createdAt)} · {formatTime(item.createdAt)}
                  </div>
                </div>
              </li>
            ))
          )}
        </ul>
      </div>
    </>
  );
}

// ============================================
// TRANSACTION DETAIL VIEW
// ============================================

function TransactionDetail({
  data,
  onBack,
  onReview,
}: {
  data: Record<string, unknown>;
  onBack: () => void;
  onReview: (id: string, action: "approve" | "reject") => void;
}) {
  const tx = data.transaction as Transaction;
  const customer = data.customer as { name: string; email: string; phone: string } | null;
  const context = data.customerContext as {
    totalPayments: number;
    successfulPayments: number;
    successRate: number;
    selfRetryRate: number;
    averageOrderValue: number;
  } | null;
  const aiAction = data.aiAction as {
    action: string;
    classification: string;
    recoverability: string;
    confidence: number;
    reason: string;
    requiresUserAction: boolean;
    policyResult: string;
  } | null;
  const auditTrail = (data.auditTrail || []) as ActivityItem[];

  return (
    <>
      <div className="page-header" style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <button className="btn btn-ghost" onClick={onBack}>
          ← Back
        </button>
        <div>
          <h1 className="page-title">Transaction {tx.id}</h1>
          <p className="page-subtitle">{customer?.name || "Unknown Customer"}</p>
        </div>
      </div>

      <div className="grid-3">
        <div>
          {/* Transaction Info */}
          <div className="section-card animate-in animate-delay-1">
            <div className="section-header">
              <h2 className="section-title">
                <IndianRupee size={16} style={{ marginRight: "6px" }} />
                Transaction
              </h2>
              <span className={`status-badge ${tx.status.toLowerCase().replace("_", "-")}`}>
                {tx.status.replace("_", " ")}
              </span>
            </div>
            <div className="detail-grid">
              <div className="detail-item">
                <span className="detail-label">Amount</span>
                <span className="detail-value large">{formatCurrency(tx.amount)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Payment Method</span>
                <span className="detail-value">{tx.paymentMethod || "Unknown"}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Failure Reason</span>
                <span className="detail-value">{tx.failureReason || "Unknown"}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Self-Retry</span>
                <span className="detail-value">
                  {tx.selfResolved ? "✅ Customer self-resolved" : tx.customerRetrying ? "🔄 Customer retrying" : "❌ No retry detected"}
                </span>
              </div>
            </div>
          </div>

          {/* Customer Context */}
          {context && (
            <div className="section-card animate-in animate-delay-2">
              <div className="section-header">
                <h2 className="section-title">
                  <User size={16} style={{ marginRight: "6px" }} />
                  Customer Context
                </h2>
              </div>
              <div className="detail-grid">
                <div className="detail-item">
                  <span className="detail-label">Payment History</span>
                  <span className="detail-value">
                    {context.successfulPayments}/{context.totalPayments} successful
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Success Rate</span>
                  <span className="detail-value" style={{ color: context.successRate > 0.8 ? "var(--accent-green)" : "var(--accent-yellow)" }}>
                    {(context.successRate * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Self-Retry Rate</span>
                  <span className="detail-value">{(context.selfRetryRate * 100).toFixed(1)}%</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Avg Order Value</span>
                  <span className="detail-value">{formatCurrency(context.averageOrderValue)}</span>
                </div>
              </div>
            </div>
          )}

          {/* AI Analysis */}
          {aiAction && (
            <div className="section-card animate-in animate-delay-3">
              <div className="section-header">
                <h2 className="section-title">
                  <Brain size={16} style={{ marginRight: "6px" }} />
                  AI Analysis
                </h2>
              </div>
              <div className="detail-grid">
                <div className="detail-item">
                  <span className="detail-label">Classification</span>
                  <span className="detail-value">{aiAction.classification?.replace(/_/g, " ")}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Recoverability</span>
                  <span className="detail-value" style={{
                    color: aiAction.recoverability === "HIGH" ? "var(--accent-green)" :
                      aiAction.recoverability === "MEDIUM" ? "var(--accent-yellow)" : "var(--accent-red)"
                  }}>
                    {aiAction.recoverability}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Confidence</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div className="confidence-bar" style={{ width: "80px" }}>
                      <div
                        className={`confidence-bar-fill ${aiAction.confidence >= 0.8 ? "high" : aiAction.confidence >= 0.6 ? "medium" : "low"}`}
                        style={{ width: `${aiAction.confidence * 100}%` }}
                      />
                    </div>
                    <span style={{ fontWeight: 700, fontSize: "16px" }}>{(aiAction.confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Recommended Action</span>
                  <span className="detail-value" style={{ color: "var(--accent-purple)", fontWeight: 700 }}>
                    {aiAction.action?.replace(/_/g, " ")}
                  </span>
                </div>
              </div>
              <div style={{ padding: "0 24px 20px" }}>
                <span className="detail-label">Reasoning</span>
                <p style={{ marginTop: "8px", color: "var(--text-secondary)", fontSize: "13px", lineHeight: 1.6 }}>
                  {aiAction.reason}
                </p>
              </div>
            </div>
          )}

          {/* Review actions for escalated */}
          {tx.status === "ESCALATED" && (
            <div className="review-actions" style={{ marginBottom: "24px" }}>
              <button className="btn btn-success" onClick={() => onReview(tx.id, "approve")}>
                <CheckCircle2 size={14} /> Approve Recovery
              </button>
              <button className="btn btn-danger" onClick={() => onReview(tx.id, "reject")}>
                <Ban size={14} /> Reject
              </button>
            </div>
          )}
        </div>

        {/* Audit Trail */}
        <div className="section-card animate-in animate-delay-4" style={{ alignSelf: "start" }}>
          <div className="section-header">
            <h2 className="section-title">
              <FileText size={16} style={{ marginRight: "6px" }} />
              Audit Trail
            </h2>
          </div>
          <ul className="audit-trail">
            {auditTrail.map((log) => (
              <li key={log.id} className="audit-item">
                <div className={`audit-dot ${log.event.includes("RECOVERED") || log.event.includes("APPROVED") || log.event.includes("SELF_RESOLVED") ? "success" :
                    log.event.includes("FAILED") || log.event.includes("REJECTED") ? "error" :
                      log.event.includes("COOLDOWN") || log.event.includes("AI") ? "info" : "warning"
                  }`} />
                <div className="audit-content">
                  <div className="audit-event">
                    {getEventIcon(log.event)} {formatEvent(log.event)}
                  </div>
                  <div className="audit-time">{formatTime(log.createdAt)}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
