"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrendPoint } from "@/lib/data/reports";

const BDT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function TrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#64748b" }} tickLine={false} axisLine={false} />
          <YAxis
            tick={{ fontSize: 12, fill: "#64748b" }}
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={(v: number) => BDT.format(v)}
          />
          <Tooltip formatter={(value) => `৳ ${BDT.format(Number(value))}`} />
          <Legend />
          <Bar dataKey="sales" name="বিক্রয়" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={36} />
          <Bar dataKey="purchases" name="ক্রয়" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={36} />
          <Bar dataKey="expenses" name="খরচ" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={36} />
          <Line
            type="monotone"
            dataKey="profit"
            name="গ্রস মুনাফা"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
