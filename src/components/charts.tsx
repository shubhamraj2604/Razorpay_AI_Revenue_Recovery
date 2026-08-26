"use client";

import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
} from "recharts";

// ============================================
// CHART COLORS
// ============================================

const COLORS = {
  recovered: "#10b981",
  selfResolved: "#06b6d4",
  escalated: "#f59e0b",
  failed: "#ef4444",
  abandoned: "#64748b",
  cooldown: "#3b82f6",
  recovering: "#8b5cf6",

  paymentLink: "#3b82f6",
  retry: "#8b5cf6",
  humanReview: "#f59e0b",
  noAction: "#06b6d4",
  stop: "#64748b",
};

// ============================================
// CUSTOM TOOLTIP
// ============================================

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "#1a1f2e",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "8px",
        padding: "12px 16px",
        fontSize: "13px",
      }}
    >
      {label && (
        <div style={{ color: "#94a3b8", marginBottom: "6px", fontWeight: 600 }}>
          {label}
        </div>
      )}
      {payload.map((entry: any, i: number) => (
        <div key={i} style={{ color: entry.color, display: "flex", gap: "8px", alignItems: "center" }}>
          <span style={{ fontWeight: 500 }}>{entry.name}:</span>
          <span style={{ fontWeight: 700 }}>
            {typeof entry.value === "number" && entry.value > 100 && !["Count", "Transactions", "Total", "Recovered", "Self-Resolved", "Escalated", "Failed", "Abandoned", "Cooldown"].includes(entry.name)
              ? `₹${(entry.value / 100).toLocaleString("en-IN")}`
              : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ============================================
// STATUS DISTRIBUTION PIE CHART
// ============================================

export function StatusPieChart({
  statusBreakdown,
}: {
  statusBreakdown: {
    recovered: number;
    selfResolved: number;
    escalated: number;
    failed: number;
    abandoned: number;
    cooldown: number;
    recovering: number;
  };
}) {
  const data = [
    { name: "Recovered", value: statusBreakdown.recovered, color: COLORS.recovered },
    { name: "Self-Resolved", value: statusBreakdown.selfResolved, color: COLORS.selfResolved },
    { name: "Escalated", value: statusBreakdown.escalated, color: COLORS.escalated },
    { name: "Failed", value: statusBreakdown.failed, color: COLORS.failed },
    { name: "Abandoned", value: statusBreakdown.abandoned, color: COLORS.abandoned },
    { name: "Cooldown", value: statusBreakdown.cooldown, color: COLORS.cooldown },
  ].filter((d) => d.value > 0);

  return (
    <div className="section-card animate-in">
      <div className="section-header">
        <h2 className="section-title">Transaction Status Distribution</h2>
      </div>
      <div style={{ padding: "20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={65}
              outerRadius={100}
              paddingAngle={3}
              dataKey="value"
              stroke="none"
            >
              {data.map((entry, index) => (
                <Cell key={index} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend
              verticalAlign="bottom"
              height={36}
              formatter={(value: string) => (
                <span style={{ color: "#94a3b8", fontSize: "12px" }}>{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ============================================
// RECOVERY BY STRATEGY BAR CHART
// ============================================

export function StrategyBarChart({ transactions }: { transactions: any[] }) {
  const strategyCounts: Record<string, { count: number; recovered: number }> = {};

  transactions.forEach((tx) => {
    const strategy = tx.selfResolved
      ? "Self-Resolved"
      : tx.aiAction === "PAYMENT_LINK"
        ? "Payment Link"
        : tx.aiAction === "RETRY"
          ? "Auto Retry"
          : tx.aiAction === "HUMAN_REVIEW"
            ? "Human Review"
            : "Other";

    if (!strategyCounts[strategy]) {
      strategyCounts[strategy] = { count: 0, recovered: 0 };
    }
    strategyCounts[strategy].count++;
    if (tx.status === "RECOVERED" || tx.status === "SELF_RESOLVED") {
      strategyCounts[strategy].recovered++;
    }
  });

  const data = Object.entries(strategyCounts).map(([name, val]) => ({
    name,
    Total: val.count,
    Recovered: val.recovered,
  }));

  return (
    <div className="section-card animate-in">
      <div className="section-header">
        <h2 className="section-title">Recovery by Strategy</h2>
      </div>
      <div style={{ padding: "20px" }}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis
              dataKey="name"
              tick={{ fill: "#64748b", fontSize: 11 }}
              axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
            />
            <YAxis
              tick={{ fill: "#64748b", fontSize: 11 }}
              axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="Total" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={32} />
            <Bar dataKey="Recovered" fill="#10b981" radius={[4, 4, 0, 0]} barSize={32} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ============================================
// FAILURE REASON BREAKDOWN
// ============================================

export function FailureReasonChart({ transactions }: { transactions: any[] }) {
  const reasons: Record<string, number> = {};

  transactions.forEach((tx) => {
    const reason = tx.failureReason?.split(":")[0]?.trim() || "Unknown";
    reasons[reason] = (reasons[reason] || 0) + 1;
  });

  const data = Object.entries(reasons)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const REASON_COLORS = ["#ef4444", "#f59e0b", "#3b82f6", "#8b5cf6", "#06b6d4", "#64748b"];

  return (
    <div className="section-card animate-in">
      <div className="section-header">
        <h2 className="section-title">Failure Reasons</h2>
      </div>
      <div style={{ padding: "20px" }}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} layout="vertical" barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis
              type="number"
              tick={{ fill: "#64748b", fontSize: 11 }}
              axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
            />
            <YAxis
              dataKey="name"
              type="category"
              width={140}
              tick={{ fill: "#94a3b8", fontSize: 11 }}
              axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="value" name="Count" radius={[0, 4, 4, 0]} barSize={20}>
              {data.map((_, index) => (
                <Cell key={index} fill={REASON_COLORS[index % REASON_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ============================================
// RECOVERY FUNNEL
// ============================================

export function RecoveryFunnel({ metrics }: { metrics: any }) {
  if (!metrics) return null;

  const funnelSteps = [
    { label: "Revenue At Risk", value: metrics.revenueAtRisk, color: "#ef4444", width: "100%" },
    { label: "Self-Resolved", value: metrics.selfResolvedAmount, color: "#06b6d4", width: `${Math.max(15, (metrics.selfResolvedAmount / Math.max(metrics.revenueAtRisk, 1)) * 100)}%` },
    { label: "Recoverable", value: metrics.recoverableAmount, color: "#f59e0b", width: `${Math.max(15, (metrics.recoverableAmount / Math.max(metrics.revenueAtRisk, 1)) * 100)}%` },
    { label: "Recovered (AI)", value: metrics.recoveredAmount, color: "#10b981", width: `${Math.max(15, (metrics.recoveredAmount / Math.max(metrics.revenueAtRisk, 1)) * 100)}%` },
  ];

  const formatVal = (paise: number) => {
    const r = paise / 100;
    if (r >= 100000) return `₹${(r / 100000).toFixed(1)}L`;
    return `₹${r.toLocaleString("en-IN")}`;
  };

  return (
    <div className="section-card animate-in">
      <div className="section-header">
        <h2 className="section-title">Recovery Funnel</h2>
      </div>
      <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
        {funnelSteps.map((step, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ width: "120px", textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                {step.label}
              </div>
              <div style={{ fontSize: "16px", fontWeight: 800, color: step.color }}>
                {formatVal(step.value)}
              </div>
            </div>
            <div style={{ flex: 1, position: "relative" }}>
              <div
                style={{
                  height: "32px",
                  width: step.width,
                  background: `linear-gradient(90deg, ${step.color}33, ${step.color}66)`,
                  border: `1px solid ${step.color}88`,
                  borderRadius: "6px",
                  transition: "width 0.8s ease",
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: "12px",
                }}
              >
                <span style={{ fontSize: "11px", fontWeight: 600, color: step.color }}>
                  {metrics.revenueAtRisk > 0
                    ? `${((step.value / metrics.revenueAtRisk) * 100).toFixed(1)}%`
                    : "0%"}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// CONFIDENCE DISTRIBUTION
// ============================================

export function ConfidenceDistribution({ transactions }: { transactions: any[] }) {
  const buckets = [
    { range: "0-30%", min: 0, max: 0.3, count: 0, color: "#ef4444" },
    { range: "30-50%", min: 0.3, max: 0.5, count: 0, color: "#f59e0b" },
    { range: "50-70%", min: 0.5, max: 0.7, count: 0, color: "#f59e0b" },
    { range: "70-85%", min: 0.7, max: 0.85, count: 0, color: "#3b82f6" },
    { range: "85-100%", min: 0.85, max: 1.01, count: 0, color: "#10b981" },
  ];

  transactions.forEach((tx) => {
    if (tx.aiConfidence != null) {
      const bucket = buckets.find((b) => tx.aiConfidence >= b.min && tx.aiConfidence < b.max);
      if (bucket) bucket.count++;
    }
  });

  return (
    <div className="section-card animate-in">
      <div className="section-header">
        <h2 className="section-title">AI Confidence Distribution</h2>
      </div>
      <div style={{ padding: "20px" }}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={buckets}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis
              dataKey="range"
              tick={{ fill: "#64748b", fontSize: 11 }}
              axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
            />
            <YAxis
              tick={{ fill: "#64748b", fontSize: 11 }}
              axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="count" name="Transactions" radius={[4, 4, 0, 0]} barSize={40}>
              {buckets.map((bucket, index) => (
                <Cell key={index} fill={bucket.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
