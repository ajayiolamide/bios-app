"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { BrainCircuit, Send, Sparkles, User, Trash2, Loader2, History, Plus, X } from "lucide-react";
import { useOrg } from "@/contexts/org-context";
import {
  askAnalyst,
  listConversations,
  getConversation,
  saveConversation,
  deleteConversation,
  type Message,
  type ConversationSummary,
} from "@/app/actions/analyst";

const SUGGESTIONS = [
  "Summarise all my data and tell me what stands out",
  "What should I focus on this week based on the data?",
  "Are there any anomalies or drops I should investigate?",
  "Which metrics are trending up vs down?",
  "Break down my top events and what they mean",
  "What data am I missing to improve this analysis?",
];

// Rotated while waiting for the first token so the user sees what the
// analyst is actually doing rather than a single static "thinking" label.
const THINKING_STEPS = [
  "Reading your events…",
  "Checking goals & KPIs…",
  "Cross-referencing sources…",
  "Reasoning over the numbers…",
];

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Markdown renderer — handles tables, bold, code, lists, line breaks ─────────

function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  function inlineFormat(s: string): React.ReactNode {
    // bold + inline code
    const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((p, j) => {
      if (p.startsWith("**") && p.endsWith("**"))
        return <strong key={j}>{p.slice(2, -2)}</strong>;
      if (p.startsWith("`") && p.endsWith("`"))
        return <code key={j} className="bg-gray-100 text-indigo-600 px-1 py-0.5 rounded text-xs font-mono">{p.slice(1, -1)}</code>;
      return p;
    });
  }

  while (i < lines.length) {
    const line = lines[i];

    // Table detection
    if (line.includes("|") && lines[i + 1]?.includes("---")) {
      const headerCells = line.split("|").map(c => c.trim()).filter(Boolean);
      i += 2; // skip separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|")) {
        rows.push(lines[i].split("|").map(c => c.trim()).filter(Boolean));
        i++;
      }
      elements.push(
        <div key={i} className="overflow-x-auto my-3">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {headerCells.map((h, j) => (
                  <th key={j} className="text-left px-3 py-2 font-semibold text-gray-700">{inlineFormat(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="border-b border-gray-100 hover:bg-gray-50">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-1.5 text-gray-700">{inlineFormat(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Headings
    if (line.startsWith("### ")) {
      elements.push(<h3 key={i} className="font-bold text-sm text-gray-800 mt-3 mb-1">{inlineFormat(line.slice(4))}</h3>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={i} className="font-bold text-base text-gray-900 mt-4 mb-1.5">{inlineFormat(line.slice(3))}</h2>);
    } else if (line.startsWith("# ")) {
      elements.push(<h1 key={i} className="font-bold text-lg text-gray-900 mt-4 mb-2">{inlineFormat(line.slice(2))}</h1>);
    // Bullet list
    } else if (/^[-*] /.test(line)) {
      const bullets: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        bullets.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <ul key={i} className="my-2 space-y-1">
          {bullets.map((b, j) => (
            <li key={j} className="flex items-start gap-2 text-sm text-gray-700">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
              <span>{inlineFormat(b)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    // Numbered list
    } else if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ""));
        i++;
      }
      elements.push(
        <ol key={i} className="my-2 space-y-1 list-none">
          {items.map((it, j) => (
            <li key={j} className="flex items-start gap-2 text-sm text-gray-700">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center mt-0.5">{j + 1}</span>
              <span>{inlineFormat(it)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    // Horizontal rule
    } else if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={i} className="my-3 border-gray-200" />);
    // Empty line
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    // Normal paragraph
    } else {
      elements.push(<p key={i} className="text-sm text-gray-700 leading-relaxed">{inlineFormat(line)}</p>);
    }
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

// ── Loading bubble — cycles through what the analyst is doing ─────────────────

function ThinkingBubble() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % THINKING_STEPS.length), 1100);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-2 text-gray-400">
      <Loader2 size={14} className="animate-spin" />
      <span className="text-sm transition-opacity">{THINKING_STEPS[step]}</span>
    </div>
  );
}

// ── History panel ───────────────────────────────────────────────────────────

function HistoryPanel({
  conversations,
  activeId,
  onSelect,
  onDelete,
  onClose,
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-0 top-12 z-20 w-80 max-h-[28rem] overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-lg">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 sticky top-0 bg-white">
        <span className="text-sm font-semibold text-gray-800">Past conversations</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={14} />
        </button>
      </div>
      {conversations.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-400 text-center">Nothing saved yet — start chatting and it'll show up here.</p>
      ) : (
        <div className="p-1.5">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`group flex items-start gap-2 rounded-xl px-2.5 py-2 cursor-pointer transition-colors ${
                c.id === activeId ? "bg-indigo-50" : "hover:bg-gray-50"
              }`}
              onClick={() => onSelect(c.id)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 truncate">{c.title}</p>
                <p className="text-xs text-gray-400 mt-0.5">{timeAgo(c.updated_at)} · {c.message_count} message{c.message_count !== 1 ? "s" : ""}</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-opacity p-1"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AIAnalystPage() {
  const { currentOrg } = useOrg();
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const refreshConversations = useCallback(async () => {
    if (!currentOrg) return;
    setConversations(await listConversations(currentOrg.id));
  }, [currentOrg]);

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Close the history dropdown on outside click.
  useEffect(() => {
    if (!showHistory) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setShowHistory(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showHistory]);

  async function send(text: string) {
    if (!currentOrg || !text.trim() || streaming) return;

    const userMsg: Message = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    let finalReply = "";
    try {
      const stream = await askAnalyst(currentOrg.id, newMessages);
      const reader = stream.getReader();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += value;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: full };
          return updated;
        });
      }
      finalReply = full;
    } catch {
      finalReply = "Something went wrong. Please try again.";
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "assistant", content: finalReply };
        return updated;
      });
    } finally {
      setStreaming(false);
    }

    // Persist the exchange so it's there next time the page is opened.
    const completedMessages = [...newMessages, { role: "assistant" as const, content: finalReply }];
    const result = await saveConversation(currentOrg.id, conversationId, completedMessages);
    if ("id" in result) {
      setConversationId(result.id);
      refreshConversations();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  function startNewChat() {
    setMessages([]);
    setConversationId(null);
    setShowHistory(false);
  }

  async function openConversation(id: string) {
    const convo = await getConversation(id);
    if (!convo) return;
    setMessages(convo.messages);
    setConversationId(convo.id);
    setShowHistory(false);
  }

  async function handleDelete(id: string) {
    await deleteConversation(id);
    if (id === conversationId) startNewChat();
    refreshConversations();
  }

  if (!currentOrg) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        No organisation selected.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-4xl mx-auto px-4 py-4">
      {/* Header */}
      <div className="relative flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0">
            <BrainCircuit className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900 leading-none">AI Analyst</h1>
            <p className="text-xs text-gray-400 mt-0.5">Reads all your connected data — ask anything</p>
          </div>
        </div>
        <div ref={panelRef} className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={startNewChat}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-indigo-600 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-50 border border-gray-200"
            >
              <Plus size={12} /> New chat
            </button>
          )}
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-indigo-600 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-50 border border-gray-200"
          >
            <History size={12} /> History
            {conversations.length > 0 && (
              <span className="text-[10px] bg-gray-100 text-gray-500 rounded-full px-1.5 py-0.5">{conversations.length}</span>
            )}
          </button>
          {showHistory && (
            <HistoryPanel
              conversations={conversations}
              activeId={conversationId}
              onSelect={openConversation}
              onDelete={handleDelete}
              onClose={() => setShowHistory(false)}
            />
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto rounded-2xl border border-gray-100 bg-gray-50/50 p-4 space-y-4 mb-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center px-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
              <Sparkles size={22} className="text-indigo-500" />
            </div>
            <div>
              <p className="font-semibold text-gray-700">Ask anything about your data</p>
              <p className="text-sm text-gray-400 mt-1">
                I can read your connected sources, events, goals, and journeys
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="flex items-start gap-2 rounded-xl border border-gray-200 bg-white p-3 text-sm text-left text-gray-500 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 transition-all"
                >
                  <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0 text-indigo-400" />
                  {s}
                </button>
              ))}
            </div>
            {conversations.length > 0 && (
              <button
                onClick={() => setShowHistory(true)}
                className="text-xs text-indigo-500 hover:text-indigo-700 flex items-center gap-1.5"
              >
                <History size={12} /> Or pick up a past conversation
              </button>
            )}
          </div>
        ) : (
          <>
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-indigo-600 mt-0.5">
                    <BrainCircuit className="h-4 w-4 text-white" />
                  </div>
                )}
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                  m.role === "user"
                    ? "bg-indigo-600 text-white rounded-tr-sm"
                    : "bg-white border border-gray-100 shadow-sm rounded-tl-sm"
                }`}>
                  {m.role === "assistant" && m.content === "" ? (
                    <ThinkingBubble />
                  ) : m.role === "assistant" ? (
                    <MarkdownText text={m.content} />
                  ) : (
                    <span className="text-sm leading-relaxed">{m.content}</span>
                  )}
                </div>
                {m.role === "user" && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-gray-200 mt-0.5">
                    <User className="h-4 w-4 text-gray-500" />
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 flex gap-2 items-end">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            rows={1}
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 pr-12 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent shadow-sm"
            placeholder="Ask anything… (Enter to send, Shift+Enter for newline)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming}
          />
        </div>
        <button
          onClick={() => send(input)}
          disabled={!input.trim() || streaming}
          className="flex items-center justify-center h-11 w-11 rounded-2xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0 shadow-sm"
        >
          {streaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
}
