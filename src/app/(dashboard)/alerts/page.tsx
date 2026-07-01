"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getAlertRules, createAlertRule, updateAlertRule, deleteAlertRule,
  evaluateRule, getAlertEventNames,
  type AlertRulePayload, type EvalResult,
} from "@/app/actions/alert-rules";
import type { AlertRule, AlertRuleType } from "@/types/database";
import {
  BellRing, Plus, Trash2, Play, Pencil, ChevronDown, ChevronUp,
  CheckCircle2, AlertTriangle, Clock, Loader2, ToggleLeft, ToggleRight,
  X,
} from "lucide-react";

// ─── Rule type metadata ───────────────────────────────────────────────────────

const RULE_TYPE_OPTIONS: { value: AlertRuleType; label: string; needsRatio: boolean; needsPct: boolean }[] = [
  { value: "event_count_drop",  label: "Event count drops by %",    needsRatio: false, needsPct: true },
  { value: "event_count_rise",  label: "Event count rises by %",    needsRatio: false, needsPct: true },
  { value: "event_ratio_drop",  label: "Event ratio drops by %",    needsRatio: true,  needsPct: true },
  { value: "event_ratio_rise",  label: "Event ratio rises by %",    needsRatio: true,  needsPct: true },
  { value: "event_count_below", label: "Event count falls below #", needsRatio: false, needsPct: false },
  { value: "event_count_above", label: "Event count rises above #", needsRatio: false, needsPct: false },
];

function ruleTypeMeta(t: AlertRuleType) {
  return RULE_TYPE_OPTIONS.find(o => o.value === t) ?? RULE_TYPE_OPTIONS[0];
}

// ─── Blank form state ─────────────────────────────────────────────────────────

type FormState = {
  name: string;
  rule_type: AlertRuleType;
  numerator_event: string;
  denominator_event: string;
  threshold_pct: string;
  threshold_abs: string;
  lookback_days: string;
  slack_webhook_override: string;
  enabled: boolean;
};

function blankForm(): FormState {
  return {
    name: "",
    rule_type: "event_ratio_drop",
    numerator_event: "",
    denominator_event: "",
    threshold_pct: "20",
    threshold_abs: "",
    lookback_days: "7",
    slack_webhook_override: "",
    enabled: true,
  };
}

function formToPayload(f: FormState): AlertRulePayload {
  const meta = ruleTypeMeta(f.rule_type);
  return {
    name: f.name.trim(),
    rule_type: f.rule_type,
    numerator_event: f.numerator_event.trim(),
    denominator_event: meta.needsRatio ? (f.denominator_event.trim() || null) : null,
    threshold_pct: meta.needsPct ? (Number(f.threshold_pct) || null) : null,
    threshold_abs: !meta.needsPct ? (Number(f.threshold_abs) || null) : null,
    lookback_days: Number(f.lookback_days) || 7,
    slack_webhook_override: f.slack_webhook_override.trim() || null,
    enabled: f.enabled,
  };
}

// ─── Rule form ────────────────────────────────────────────────────────────────

function RuleForm({
  initial, onSave, onCancel, eventNames,
}: {
  initial?: AlertRule;
  onSave: (payload: AlertRulePayload) => Promise<void>;
  onCancel: () => void;
  eventNames: string[];
}) {
  const [form, setForm] = useState<FormState>(() => {
    if (!initial) return blankForm();
    return {
      name: initial.name,
      rule_type: initial.rule_type,
      numerator_event: initial.numerator_event,
      denominator_event: initial.denominator_event ?? "",
      threshold_pct: initial.threshold_pct?.toString() ?? "20",
      threshold_abs: initial.threshold_abs?.toString() ?? "",
      lookback_days: initial.lookback_days.toString(),
      slack_webhook_override: initial.slack_webhook_override ?? "",
      enabled: initial.enabled,
    };
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const meta = ruleTypeMeta(form.rule_type);

  const set = (key: keyof FormState, val: string | boolean) =>
    setForm(prev => ({ ...prev, [key]: val }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!form.name.trim()) { setErr("Name is required"); return; }
    if (!form.numerator_event.trim()) { setErr("Primary event is required"); return; }
    if (meta.needsRatio && !form.denominator_event.trim()) { setErr("Denominator event is required for ratio rules"); return; }
    if (meta.needsPct && !Number(form.threshold_pct)) { setErr("Threshold % is required"); return; }
    if (!meta.needsPct && !Number(form.threshold_abs)) { setErr("Threshold number is required"); return; }
    setSaving(true);
    try {
      await onSave(formToPayload(form));
    } catch (e2) {
      setErr((e2 as Error).message);
      setSaving(false);
    }
  };

  const fieldCls = "w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white";
  const labelCls = "block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 border border-indigo-200 rounded-xl bg-indigo-50/40">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-semibold text-gray-800">{initial ? "Edit alert rule" : "New alert rule"}</p>
        <button type="button" onClick={onCancel} className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-white transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* Name */}
      <div>
        <label className={labelCls}>Rule name</label>
        <input value={form.name} onChange={e => set("name", e.target.value)}
          placeholder="e.g. Payment conversion drops"
          className={fieldCls} />
      </div>

      {/* Rule type */}
      <div>
        <label className={labelCls}>Condition type</label>
        <select value={form.rule_type} onChange={e => set("rule_type", e.target.value as AlertRuleType)} className={fieldCls}>
          {RULE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Events */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>{meta.needsRatio ? "Numerator event" : "Event name"}</label>
          <input
            list="alert-events"
            value={form.numerator_event}
            onChange={e => set("numerator_event", e.target.value)}
            placeholder="e.g. payment_completed"
            className={fieldCls} />
        </div>
        {meta.needsRatio && (
          <div>
            <label className={labelCls}>Denominator event</label>
            <input
              list="alert-events"
              value={form.denominator_event}
              onChange={e => set("denominator_event", e.target.value)}
              placeholder="e.g. payment_clicked"
              className={fieldCls} />
          </div>
        )}
      </div>
      <datalist id="alert-events">
        {eventNames.map(n => <option key={n} value={n} />)}
      </datalist>

      {/* Threshold */}
      <div className="grid grid-cols-2 gap-3">
        {meta.needsPct ? (
          <div>
            <label className={labelCls}>Threshold (%)</label>
            <input type="number" min={1} max={100} value={form.threshold_pct} onChange={e => set("threshold_pct", e.target.value)}
              placeholder="20" className={fieldCls} />
            <p className="text-[10px] text-gray-400 mt-1">Alert fires if change exceeds this %</p>
          </div>
        ) : (
          <div>
            <label className={labelCls}>Threshold (count)</label>
            <input type="number" min={0} value={form.threshold_abs} onChange={e => set("threshold_abs", e.target.value)}
              placeholder="100" className={fieldCls} />
          </div>
        )}
        <div>
          <label className={labelCls}>Lookback window (days)</label>
          <input type="number" min={1} max={90} value={form.lookback_days} onChange={e => set("lookback_days", e.target.value)}
            placeholder="7" className={fieldCls} />
          <p className="text-[10px] text-gray-400 mt-1">Compare last N days vs prior N days</p>
        </div>
      </div>

      {/* Slack override */}
      <div>
        <label className={labelCls}>Slack webhook (optional — leave blank to use org default)</label>
        <input value={form.slack_webhook_override} onChange={e => set("slack_webhook_override", e.target.value)}
          placeholder="https://hooks.slack.com/services/..."
          className={fieldCls} />
      </div>

      {err && <p className="text-xs text-red-500">{err}</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving}
          className="flex items-center gap-1.5 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 px-4 py-2 rounded-lg disabled:opacity-50 transition-colors">
          {saving ? <Loader2 size={13} className="animate-spin" /> : null}
          {initial ? "Save changes" : "Create rule"}
        </button>
        <button type="button" onClick={onCancel}
          className="text-sm font-medium text-gray-500 hover:text-gray-800 px-4 py-2 rounded-lg transition-colors">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Rule card ────────────────────────────────────────────────────────────────

function RuleCard({
  rule, onToggle, onEdit, onDelete, onTest,
}: {
  rule: AlertRule;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
}) {
  const meta = ruleTypeMeta(rule.rule_type);
  const lastResult = rule.last_result;
  const isRatio = !!rule.denominator_event;

  return (
    <div className={`border rounded-xl p-4 transition-colors ${rule.enabled ? "border-gray-200 bg-white" : "border-gray-100 bg-gray-50"}`}>
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${rule.enabled ? "bg-indigo-50" : "bg-gray-100"}`}>
          <BellRing size={15} className={rule.enabled ? "text-indigo-600" : "text-gray-400"} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`text-sm font-semibold ${rule.enabled ? "text-gray-900" : "text-gray-400"}`}>{rule.name}</p>
            {!rule.enabled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400 font-medium">Paused</span>}
          </div>

          {/* Rule description */}
          <p className="text-xs text-gray-500 mt-0.5">
            {meta.label} — <span className="font-mono text-gray-700">{rule.numerator_event}</span>
            {rule.denominator_event && <> ÷ <span className="font-mono text-gray-700">{rule.denominator_event}</span></>}
            {meta.needsPct && <> &gt; <strong>{rule.threshold_pct}%</strong> change</>}
            {!meta.needsPct && <> threshold: <strong>{rule.threshold_abs}</strong></>}
            {" "}over <strong>{rule.lookback_days}d</strong>
          </p>

          {/* Last result */}
          {lastResult && (
            <div className={`mt-2 flex items-center gap-2 text-xs rounded-lg px-2.5 py-1.5 w-fit ${lastResult.fired ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
              {lastResult.fired
                ? <AlertTriangle size={11} />
                : <CheckCircle2 size={11} />}
              {isRatio
                ? `${lastResult.current.toFixed(1)}% → ${lastResult.pct_change >= 0 ? "+" : ""}${lastResult.pct_change.toFixed(1)}% vs prior`
                : `${lastResult.current} events → ${lastResult.pct_change >= 0 ? "+" : ""}${lastResult.pct_change.toFixed(1)}% vs prior`}
              {lastResult.fired && " 🚨 Fired"}
            </div>
          )}

          {/* Last checked / fired */}
          <div className="flex items-center gap-3 mt-2">
            {rule.last_checked_at && (
              <p className="text-[10px] text-gray-400 flex items-center gap-1">
                <Clock size={9} />
                Checked {new Date(rule.last_checked_at).toLocaleString()}
              </p>
            )}
            {rule.last_fired_at && (
              <p className="text-[10px] text-orange-500 flex items-center gap-1">
                <AlertTriangle size={9} />
                Last fired {new Date(rule.last_fired_at).toLocaleString()}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onTest} title="Test now"
            className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors" title="Evaluate now">
            <Play size={13} />
          </button>
          <button onClick={onEdit} title="Edit"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <Pencil size={13} />
          </button>
          <button onClick={onToggle} title={rule.enabled ? "Pause" : "Resume"}
            className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
            {rule.enabled ? <ToggleRight size={15} className="text-indigo-600" /> : <ToggleLeft size={15} />}
          </button>
          <button onClick={onDelete} title="Delete"
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [eventNames, setEventNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; result: EvalResult } | null>(null);

  const load = useCallback(async () => {
    const [r, e] = await Promise.all([getAlertRules(), getAlertEventNames()]);
    setRules(r);
    setEventNames(e);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (payload: AlertRulePayload) => {
    await createAlertRule(payload);
    setShowForm(false);
    await load();
  };

  const handleUpdate = async (payload: AlertRulePayload) => {
    if (!editingRule) return;
    await updateAlertRule(editingRule.id, payload);
    setEditingRule(null);
    await load();
  };

  const handleToggle = async (rule: AlertRule) => {
    await updateAlertRule(rule.id, { enabled: !rule.enabled });
    await load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this alert rule?")) return;
    await deleteAlertRule(id);
    await load();
  };

  const handleTest = async (rule: AlertRule) => {
    setTestingId(rule.id);
    setTestResult(null);
    try {
      const result = await evaluateRule(rule.id);
      setTestResult({ id: rule.id, result });
      await load(); // refresh last_result display
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-black text-gray-900 tracking-tight">Alert rules</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Configure conditions that trigger Slack notifications — fires only when something actually changes.
          </p>
        </div>
        {!showForm && !editingRule && (
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 px-3.5 py-2 rounded-lg transition-colors">
            <Plus size={14} /> New rule
          </button>
        )}
      </div>

      {/* How it works */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mb-5 text-sm text-indigo-800 space-y-1">
        <p className="font-semibold text-indigo-900">How alert rules work</p>
        <p className="text-xs text-indigo-700 leading-relaxed">
          Each rule watches an event count or ratio (e.g. <code className="bg-indigo-100 px-1 rounded">payment_completed ÷ payment_clicked</code>) over a rolling window.
          When the condition is met — like a {">"}20% drop vs the prior period — it posts to Slack. Rules only fire when something actually changes, not on every check.
          Use <strong>Test now</strong> (▶) to evaluate a rule immediately without waiting for the schedule.
        </p>
      </div>

      {/* SQL migration notice */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
        <p className="text-xs font-semibold text-amber-800 mb-1.5">⚠️ One-time Supabase setup required</p>
        <p className="text-xs text-amber-700 mb-2">Run this SQL in your Supabase dashboard (SQL Editor) to create the alert_rules table:</p>
        <pre className="text-[10px] bg-amber-100 rounded-lg p-3 overflow-x-auto text-amber-900 leading-relaxed">{`create table if not exists alert_rules (
  id uuid default gen_random_uuid() primary key,
  organization_id uuid references organizations(id) on delete cascade not null,
  name text not null,
  enabled boolean not null default true,
  rule_type text not null,
  numerator_event text not null,
  denominator_event text,
  threshold_pct integer,
  threshold_abs integer,
  lookback_days integer not null default 7,
  slack_webhook_override text,
  last_fired_at timestamptz,
  last_checked_at timestamptz,
  last_result jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);
alter table alert_rules enable row level security;
create policy "org members manage alert_rules" on alert_rules
  using (organization_id in (
    select organization_id from organization_members where user_id = auth.uid()
  ))
  with check (organization_id in (
    select organization_id from organization_members where user_id = auth.uid()
  ));`}</pre>
      </div>

      {/* New rule form */}
      {showForm && (
        <div className="mb-4">
          <RuleForm eventNames={eventNames} onSave={handleCreate} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {/* Test result banner */}
      {testResult && (
        <div className={`mb-4 rounded-xl p-4 border text-sm ${testResult.result.fired ? "bg-red-50 border-red-200 text-red-800" : "bg-green-50 border-green-200 text-green-800"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              {testResult.result.fired ? <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /> : <CheckCircle2 size={15} className="flex-shrink-0 mt-0.5" />}
              <p className="text-xs leading-relaxed whitespace-pre-wrap">{testResult.result.message}</p>
            </div>
            <button onClick={() => setTestResult(null)} className="p-1 rounded text-current opacity-50 hover:opacity-100 flex-shrink-0">
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Rules list */}
      {loading ? (
        <div className="flex items-center justify-center h-32 text-gray-400">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : rules.length === 0 && !showForm ? (
        <div className="text-center py-16 text-gray-400">
          <BellRing size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium text-gray-500">No alert rules yet</p>
          <p className="text-xs mt-1">Create a rule to get notified when something drops or spikes.</p>
          <button onClick={() => setShowForm(true)}
            className="mt-4 flex items-center gap-1.5 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 px-4 py-2 rounded-lg transition-colors mx-auto">
            <Plus size={13} /> Create first rule
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map(rule => (
            editingRule?.id === rule.id ? (
              <RuleForm
                key={rule.id}
                initial={rule}
                eventNames={eventNames}
                onSave={handleUpdate}
                onCancel={() => setEditingRule(null)}
              />
            ) : (
              <div key={rule.id} className="relative">
                {testingId === rule.id && (
                  <div className="absolute inset-0 bg-white/70 rounded-xl flex items-center justify-center z-10">
                    <div className="flex items-center gap-2 text-sm text-indigo-600 font-medium">
                      <Loader2 size={14} className="animate-spin" /> Evaluating…
                    </div>
                  </div>
                )}
                <RuleCard
                  rule={rule}
                  onToggle={() => handleToggle(rule)}
                  onEdit={() => { setShowForm(false); setEditingRule(rule); }}
                  onDelete={() => handleDelete(rule.id)}
                  onTest={() => handleTest(rule)}
                />
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}
